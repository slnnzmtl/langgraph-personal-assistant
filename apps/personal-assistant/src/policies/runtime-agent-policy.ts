import { AIMessage } from "@langchain/core/messages";

import {
  buildDirectoryTree,
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
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityCatalog } from "@personal-assistant/supervisor-framework";
import type { ContextCacheKit } from "@personal-assistant/supervisor-framework";
import {
  OBSIDIAN_VAULT_CAPABILITY_ID,
  type PersonalCapabilityDeps,
} from "../runtime-agents/capabilities.js";
import type { PersonalResolveTools } from "../runtime-agents/resolve-tools.js";
import {
  composeObsidianCapabilityHooks,
  formatObsidianRoutineHint,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "../runtime-agents/obsidian/hooks.js";
import { createContextCacheRuntimeConfig } from "./context-cache-runtime.js";

export const hasObsidianVaultCapability = (definition: RuntimeAgentDefinition): boolean =>
  resolveAgentCapabilityIds(definition).includes(OBSIDIAN_VAULT_CAPABILITY_ID);

export type DefaultRuntimePolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
  contextCache?: ContextCacheKit;
};

type CapabilityBehaviorContext = {
  definition: RuntimeAgentDefinition;
  capabilityDeps: PersonalCapabilityDeps;
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

const mergeCacheHooks = (
  baseHooks: RuntimeAgentNodeHooks,
  definition: RuntimeAgentDefinition,
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
  skillCatalog: SkillCatalog | undefined,
  contextCache: ContextCacheKit | undefined,
  resolveExtraDynamicSections?: Parameters<
    typeof createContextCacheRuntimeConfig
  >[1]["resolveExtraDynamicSections"],
): RuntimeAgentNodeHooks => {
  if (!contextCache || !skillCatalog) {
    return baseHooks;
  }

  return {
    ...baseHooks,
    ...createContextCacheRuntimeConfig(contextCache, {
      modelName: contextCache.resolveRuntimeModelName(definition),
      skillCatalog,
      shellFormatters,
      displayName: `runtime-agent-${definition.id}`,
      ...(resolveExtraDynamicSections ? { resolveExtraDynamicSections } : {}),
    }),
  };
};

const defaultBehavior = (
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]> | undefined,
  contextCache: ContextCacheKit | undefined,
  skillCatalog: SkillCatalog | undefined,
): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error, definition) =>
    `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
  createHooks: ({ definition }) => {
    if (!shellFormatters) {
      return shellHooks;
    }

    return mergeCacheHooks(shellHooks, definition, shellFormatters, skillCatalog, contextCache);
  },
});

const systemConfigBehavior = (
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
  contextCache: ContextCacheKit | undefined,
  skillCatalog: SkillCatalog | undefined,
): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error) =>
    `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  createHooks: ({ definition }) =>
    mergeCacheHooks(
      createSystemAgentNodeHooks(shellFormatters),
      definition,
      shellFormatters,
      skillCatalog,
      contextCache,
    ),
  mapResult: (result, { maxSteps, name }) => mapConfigurationSubAgentResult(result, maxSteps, name),
});

const obsidianBehavior = (
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
  contextCache: ContextCacheKit | undefined,
  skillCatalog: SkillCatalog | undefined,
): CapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error) =>
    `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
  createHooks: ({ capabilityDeps, definition }) => {
    const vaultRoot = capabilityDeps.obsidianVault?.rootPath;
    if (!vaultRoot) {
      return mergeCacheHooks(shellHooks, definition, shellFormatters, skillCatalog, contextCache);
    }

    const cacheHooks = mergeCacheHooks(
      shellHooks,
      definition,
      shellFormatters,
      skillCatalog,
      contextCache,
      async () => [
        `Vault directory tree (folders only):\n${await buildDirectoryTree(vaultRoot)}`,
        formatObsidianRoutineHint(),
      ],
    );

    const obsidianHooks = composeObsidianCapabilityHooks(vaultRoot, shellFormatters, cacheHooks);

    // Prefer cache prompt/model hooks when active so vault context stays in <turn_context>.
    if (contextCache && skillCatalog) {
      return {
        ...obsidianHooks,
        ...(cacheHooks.buildSystemPrompt
          ? { buildSystemPrompt: cacheHooks.buildSystemPrompt }
          : {}),
        ...(cacheHooks.buildPromptMessages
          ? { buildPromptMessages: cacheHooks.buildPromptMessages }
          : {}),
        ...(cacheHooks.resolveModelForTurn
          ? { resolveModelForTurn: cacheHooks.resolveModelForTurn }
          : {}),
      };
    }

    return obsidianHooks;
  },
  // Tool filtering changes the cache fingerprint mid-session; keep the full set when caching.
  ...(contextCache ? {} : { selectToolsForTurn: selectObsidianToolsForTurn }),
  mapResult: (result, { maxSteps }) =>
    mapObsidianSubAgentResult(result, maxSteps, () => ({
      messages: [
        new AIMessage(
          `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
        ),
      ],
    })),
});

export type ResolveCapabilityBehaviorOptions = {
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"] | undefined;
  contextCache?: ContextCacheKit | undefined;
  skillCatalog?: SkillCatalog | undefined;
};

export const resolveCapabilityBehavior = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: ResolveCapabilityBehaviorOptions = {},
): CapabilityBehavior => {
  const { shellFormatters, contextCache, skillCatalog } = options;

  if (hasSystemConfigWriteCapability(definition)) {
    if (!shellFormatters) {
      throw new Error("System configuration hooks require runtime shell formatters.");
    }

    return systemConfigBehavior(shellFormatters, contextCache, skillCatalog);
  }

  if (hasObsidianVaultCapability(definition)) {
    if (!shellFormatters) {
      throw new Error("Obsidian capability hooks require runtime shell formatters.");
    }

    return obsidianBehavior(shellHooks, shellFormatters, contextCache, skillCatalog);
  }

  return defaultBehavior(shellHooks, shellFormatters, contextCache, skillCatalog);
};

export const buildRuntimeAgentNodeConfigForDefinition = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
  policyOptions?: Pick<DefaultRuntimePolicyOptions, "contextCache" | "skillCatalog">,
): RuntimeAgentNodeConfig => {
  const behavior = resolveCapabilityBehavior(definition, shellHooks, {
    shellFormatters,
    contextCache: policyOptions?.contextCache,
    skillCatalog: policyOptions?.skillCatalog,
  });

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
): RuntimeAgentPolicy => {
  const behaviorFor = (
    definition: RuntimeAgentDefinition,
    shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
  ): CapabilityBehavior =>
    resolveCapabilityBehavior(definition, shellHooks, {
      shellFormatters: shellFormatters ?? options.shellFormatters,
      contextCache: options.contextCache,
      skillCatalog: options.skillCatalog,
    });

  return createAgentPolicy<PersonalCapabilityDeps>({
    resolveDeps: (context, definition) => resolveSystemConfigDeps(context, definition),
    unavailableMessage: () => SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) =>
      behaviorFor(deps.definition, policyOptions.shellFormatters).createHooks({
        definition: deps.definition,
        capabilityDeps: deps.capabilityDeps,
        shellHooks,
        shellFormatters: policyOptions.shellFormatters!,
      }),
    selectToolsForTurn: (ctx, tools) => {
      const behavior = behaviorFor(ctx.definition);
      return behavior.selectToolsForTurn ? behavior.selectToolsForTurn(ctx, tools) : tools;
    },
    resolveMapResult: (definition) => behaviorFor(definition).mapResult,
    logLabel: "runtime-agent",
    buildErrorMessage: (error, definition) => behaviorFor(definition).buildErrorMessage(error, definition),
  }, options);
};
