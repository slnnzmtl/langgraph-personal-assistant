import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  isCapabilityAvailable,
  isCapabilityGrantable,
  type CapabilityAvailabilityContext,
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "./types.js";

export type CapabilityCatalog = {
  listDescriptors(): CapabilityDescriptor[];
  listAvailable(context: CapabilityAvailabilityContext): CapabilityDescriptor[];
  listGrantable(context: CapabilityAvailabilityContext): CapabilityDescriptor[];
  validateIds(
    ids: readonly string[],
    context: CapabilityAvailabilityContext,
  ): void;
  validateGrantableIds(
    ids: readonly string[],
    context: CapabilityAvailabilityContext,
  ): void;
  resolveTools(
    ids: readonly string[],
    deps: Record<string, unknown>,
    context: CapabilityAvailabilityContext,
  ): StructuredToolInterface[];
  formatCatalog(context: CapabilityAvailabilityContext): string;
  formatGrantableCatalog(context: CapabilityAvailabilityContext): string;
  createIdSchema(): z.ZodEnum<Record<string, string>>;
};

export const createCapabilityCatalog = (
  providers: CapabilityProvider<Record<string, unknown>>[],
): CapabilityCatalog => {
  const providerById = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  const descriptors = providers.map((provider) => provider.descriptor);
  const descriptorIds = descriptors.map((descriptor) => descriptor.id) as [string, ...string[]];

  const listAvailable = (context: CapabilityAvailabilityContext): CapabilityDescriptor[] =>
    descriptors.filter((descriptor) => isCapabilityAvailable(descriptor, context));

  const listGrantable = (context: CapabilityAvailabilityContext): CapabilityDescriptor[] =>
    listAvailable(context).filter((descriptor) => isCapabilityGrantable(descriptor));

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

    validateIds(ids: readonly string[], context: CapabilityAvailabilityContext): void {
      const availableIds = new Set(listAvailable(context).map((entry) => entry.id));

      for (const id of ids) {
        if (!providerById.has(id)) {
          throw new Error(`Unknown capability: ${id}`);
        }

        if (!availableIds.has(id)) {
          throw new Error(`Capability is unavailable in this deployment: ${id}`);
        }
      }
    },

    validateGrantableIds(ids: readonly string[], context: CapabilityAvailabilityContext): void {
      const grantableIds = new Set(listGrantable(context).map((entry) => entry.id));
      const availableIds = new Set(listAvailable(context).map((entry) => entry.id));

      for (const id of ids) {
        if (!providerById.has(id)) {
          throw new Error(`Unknown capability: ${id}`);
        }

        if (!availableIds.has(id)) {
          throw new Error(`Capability is unavailable in this deployment: ${id}`);
        }

        if (!grantableIds.has(id)) {
          throw new Error(`Capability cannot be granted to runtime agents: ${id}`);
        }
      }
    },

    resolveTools(
      ids: readonly string[],
      deps: Record<string, unknown>,
      context: CapabilityAvailabilityContext,
    ): StructuredToolInterface[] {
      this.validateIds(ids, context);

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

    formatCatalog(context: CapabilityAvailabilityContext): string {
      return formatDescriptorList(
        listAvailable(context),
        "No capabilities are available in this deployment.",
      );
    },

    formatGrantableCatalog(context: CapabilityAvailabilityContext): string {
      return formatDescriptorList(
        listGrantable(context),
        "No grantable capabilities are available in this deployment.",
      );
    },

    createIdSchema(): z.ZodEnum<Record<string, string>> {
      if (descriptorIds.length === 0) {
        throw new Error("Capability catalog must contain at least one descriptor.");
      }

      return z.enum(descriptorIds as [string, ...string[]]);
    },
  };
};
