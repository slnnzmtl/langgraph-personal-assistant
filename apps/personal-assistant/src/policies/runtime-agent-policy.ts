import { AIMessage } from "@langchain/core/messages";

import {
  createAgentPolicy,
  createSystemAgentNodeHooks,
  mapConfigurationSubAgentResult,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
  hasSystemConfigWriteCapability,
  resolveAgentCapabilityIds,
  type AgentPolicyToolkitOptions,
  type AgentStateUpdate,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
  type SubAgentState,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityCatalog } from "@personal-assistant/supervisor-framework";
import type { CapabilityDeps } from "../runtime-agents/builtin-capabilities.js";
import type { PersonalResolveTools } from "../composition/personal-resolve-tools.js";
import {
  composeObsidianCapabilityHooks,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "./obsidian-hooks.js";

export const OBSIDIAN_VAULT_CAPABILITY_ID = "obsidian-vault";

export const hasObsidianVaultCapability = (definition: RuntimeAgentDefinition): boolean =>
  resolveAgentCapabilityIds(definition).includes(OBSIDIAN_VAULT_CAPABILITY_ID);

export type DefaultRuntimePolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
};

type CapabilityBehaviorContext = {
  definition: RuntimeAgentDefinition;
  capabilityDeps: CapabilityDeps;
  shellHooks: RuntimeAgentNodeHooks;
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
};

type CapabilityBehavior = {
  logLabel: string;
  buildErrorMessage: (error: unknown, definition: RuntimeAgentDefinition) => string;
  createHooks: (ctx: CapabilityBehaviorContext) => RuntimeAgentNodeHooks;
  selectToolsForTurn?: RuntimeAgentNodeConfig["selectToolsForTurn"];
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
};

const defaultBehavior = (shellHooks: RuntimeAgentNodeHooks): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error, definition) =>
    `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
  createHooks: () => shellHooks,
});

const systemConfigBehavior = (
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error) =>
    `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  createHooks: () => createSystemAgentNodeHooks(shellFormatters),
  mapResult: (result, { maxSteps, name }) => mapConfigurationSubAgentResult(result, maxSteps, name),
});

const obsidianBehavior = (
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error) =>
    `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
  createHooks: ({ capabilityDeps }) => {
    const vaultRoot = capabilityDeps.obsidianVaultPath;
    if (!vaultRoot) {
      return shellHooks;
    }

    return composeObsidianCapabilityHooks(vaultRoot, shellFormatters, shellHooks);
  },
  selectToolsForTurn: selectObsidianToolsForTurn,
  mapResult: (result, { maxSteps }) =>
    mapObsidianSubAgentResult(result, maxSteps, () => ({
      messages: [
        new AIMessage(
          `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
        ),
      ],
    })),
});

export const resolveCapabilityBehavior = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
): CapabilityBehavior => {
  if (hasSystemConfigWriteCapability(definition)) {
    if (!shellFormatters) {
      throw new Error("System configuration hooks require runtime shell formatters.");
    }

    return systemConfigBehavior(shellFormatters);
  }

  if (hasObsidianVaultCapability(definition)) {
    if (!shellFormatters) {
      throw new Error("Obsidian capability hooks require runtime shell formatters.");
    }

    return obsidianBehavior(shellHooks, shellFormatters);
  }

  return defaultBehavior(shellHooks);
};

export const buildRuntimeAgentNodeConfigForDefinition = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
): RuntimeAgentNodeConfig => {
  const behavior = resolveCapabilityBehavior(definition, shellHooks, shellFormatters);

  return {
    logLabel: behavior.logLabel,
    buildErrorMessage: behavior.buildErrorMessage,
    ...(behavior.selectToolsForTurn ? { selectToolsForTurn: behavior.selectToolsForTurn } : {}),
  };
};

/**
 * Default runtime policy: shared shell hooks + app-local capability behaviors
 * (e.g. obsidian-vault vault context and blank-reply recovery).
 */
export const createDefaultRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
): RuntimeAgentPolicy =>
  createAgentPolicy<CapabilityDeps>({
    resolveDeps: (context, definition) => resolveSystemConfigDeps(context, definition),
    unavailableMessage: () => SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) =>
      resolveCapabilityBehavior(deps.definition, shellHooks, policyOptions.shellFormatters).createHooks({
        definition: deps.definition,
        capabilityDeps: deps.capabilityDeps,
        shellHooks,
        shellFormatters: policyOptions.shellFormatters!,
      }),
    selectToolsForTurn: (ctx, tools) => {
      const behavior = resolveCapabilityBehavior(ctx.definition, shellHooks, options.shellFormatters);
      return behavior.selectToolsForTurn ? behavior.selectToolsForTurn(ctx, tools) : tools;
    },
    resolveMapResult: (definition) =>
      resolveCapabilityBehavior(definition, shellHooks, options.shellFormatters).mapResult,
    logLabel: "runtime-agent",
    buildErrorMessage: (error, definition) =>
      resolveCapabilityBehavior(definition, shellHooks, options.shellFormatters).buildErrorMessage(
        error,
        definition,
      ),
  }, options);
