import {
  createAgentPolicy,
  createSystemAgentNodeHooks,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
  hasSystemConfigWriteCapability,
  type AgentPolicyToolkitOptions,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityCatalog } from "@personal-assistant/supervisor-framework";
import type { ContextCacheKit } from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../runtime-agents/personal-capability-deps.js";
import type { PersonalResolveTools } from "../runtime-agents/resolve-tools.js";
import { mergeRuntimeCacheHooks } from "./context-cache-runtime.js";

export type DefaultRuntimePolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
  contextCache?: ContextCacheKit;
};

const defaultErrorMessage = (error: unknown, definition: { name: string }): string =>
  `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`;

const systemConfigErrorMessage = (error: unknown): string =>
  `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`;

/**
 * Default runtime policy: shared shell hooks + system-configuration LLM hooks.
 * Product-domain hooks (e.g. Obsidian) are composed in personal-pack / personal-runtime-policy.
 * Finalize salvage comes from hooks.resultMapping (createSystemAgentNodeHooks).
 */
export const createDefaultRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
): RuntimeAgentPolicy =>
  createAgentPolicy<PersonalCapabilityDeps>({
    resolveDeps: (context, definition) => resolveSystemConfigDeps(context, definition),
    unavailableMessage: () => SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) => {
      const { definition } = deps;
      const shellFormatters = policyOptions.shellFormatters!;
      const { contextCache, skillCatalog } = options;

      if (hasSystemConfigWriteCapability(definition)) {
        return mergeRuntimeCacheHooks(
          createSystemAgentNodeHooks(shellFormatters),
          definition,
          shellFormatters,
          skillCatalog,
          contextCache,
        );
      }

      return mergeRuntimeCacheHooks(
        shellHooks,
        definition,
        shellFormatters,
        skillCatalog,
        contextCache,
      );
    },
    logLabel: "runtime-agent",
    buildErrorMessage: (error, definition) =>
      hasSystemConfigWriteCapability(definition)
        ? systemConfigErrorMessage(error)
        : defaultErrorMessage(error, definition),
  }, options);
