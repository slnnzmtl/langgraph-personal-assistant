import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  NONE_CAPABILITY_ID,
  NONE_CAPABILITY_PROVIDER,
} from "../framework/defaults/none-capability.js";
import {
  isCapabilityGrantable,
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "./types.js";

export type CapabilityCatalog = {
  listDescriptors(): CapabilityDescriptor[];
  listAvailable(deps: Record<string, unknown>): CapabilityDescriptor[];
  listGrantable(deps: Record<string, unknown>): CapabilityDescriptor[];
  validateIds(ids: readonly string[], deps: Record<string, unknown>): void;
  validateGrantableIds(ids: readonly string[], deps: Record<string, unknown>): void;
  resolveTools(ids: readonly string[], deps: Record<string, unknown>): StructuredToolInterface[];
  formatCatalog(deps: Record<string, unknown>): string;
  formatGrantableCatalog(deps: Record<string, unknown>): string;
  createGrantableIdSchema(deps: Record<string, unknown>): z.ZodEnum<Record<string, string>>;
};

const withNoneCapability = (
  providers: CapabilityProvider<Record<string, unknown>>[],
): CapabilityProvider<Record<string, unknown>>[] => {
  if (providers.some((provider) => provider.descriptor.id === NONE_CAPABILITY_ID)) {
    return providers;
  }

  return [NONE_CAPABILITY_PROVIDER, ...providers];
};

export const createCapabilityCatalog = (
  providers: CapabilityProvider<Record<string, unknown>>[],
): CapabilityCatalog => {
  const resolvedProviders = withNoneCapability(providers);
  const providerById = new Map(
    resolvedProviders.map((provider) => [provider.descriptor.id, provider]),
  );
  const descriptors = resolvedProviders.map((provider) => provider.descriptor);

  const listAvailable = (deps: Record<string, unknown>): CapabilityDescriptor[] =>
    resolvedProviders
      .filter((provider) => provider.isAvailable(deps))
      .map((provider) => provider.descriptor);

  const listGrantable = (deps: Record<string, unknown>): CapabilityDescriptor[] =>
    resolvedProviders
      .filter((provider) => isCapabilityGrantable(provider, deps))
      .map((provider) => provider.descriptor);

  const formatDescriptorList = (entries: CapabilityDescriptor[], emptyMessage: string): string => {
    if (entries.length === 0) {
      return emptyMessage;
    }

    return entries
      .map((entry) => `- ${entry.id}: ${entry.description}`)
      .join("\n");
  };

  return {
    listDescriptors: () => [...descriptors],

    listAvailable,

    listGrantable,

    validateIds(ids: readonly string[], deps: Record<string, unknown>): void {
      const availableIds = new Set(listAvailable(deps).map((entry) => entry.id));

      for (const id of ids) {
        if (!providerById.has(id)) {
          throw new Error(`Unknown capability: ${id}`);
        }

        if (!availableIds.has(id)) {
          throw new Error(`Capability is unavailable in this deployment: ${id}`);
        }
      }
    },

    validateGrantableIds(ids: readonly string[], deps: Record<string, unknown>): void {
      const grantableIds = new Set(listGrantable(deps).map((entry) => entry.id));

      for (const id of ids) {
        if (!providerById.has(id)) {
          throw new Error(`Unknown capability: ${id}`);
        }

        if (!grantableIds.has(id)) {
          const provider = providerById.get(id);
          if (provider && !provider.isAvailable(deps)) {
            throw new Error(`Capability is unavailable in this deployment: ${id}`);
          }

          throw new Error(`Capability cannot be granted to runtime agents: ${id}`);
        }
      }
    },

    resolveTools(ids: readonly string[], deps: Record<string, unknown>): StructuredToolInterface[] {
      this.validateIds(ids, deps);

      const seen = new Set<string>();
      const tools: StructuredToolInterface[] = [];

      for (const id of ids) {
        const provider = providerById.get(id);
        if (!provider) {
          continue;
        }

        for (const tool of provider.resolveTools(deps)) {
          if (seen.has(tool.name)) {
            continue;
          }

          seen.add(tool.name);
          tools.push(tool);
        }
      }

      return tools;
    },

    formatCatalog(deps: Record<string, unknown>): string {
      return formatDescriptorList(
        listAvailable(deps),
        "No capabilities are available in this deployment.",
      );
    },

    formatGrantableCatalog(deps: Record<string, unknown>): string {
      return formatDescriptorList(
        listGrantable(deps),
        "No grantable capabilities are available in this deployment.",
      );
    },

    createGrantableIdSchema(deps: Record<string, unknown>): z.ZodEnum<Record<string, string>> {
      const grantableIds = listGrantable(deps).map((entry) => entry.id) as [string, ...string[]];

      if (grantableIds.length === 0) {
        throw new Error("No grantable capabilities are available in this deployment.");
      }

      return z.enum(grantableIds);
    },
  };
};
