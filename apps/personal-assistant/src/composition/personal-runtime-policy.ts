import {
  buildDirectoryTree,
  createAgentPolicy,
  createSystemAgentNodeHooks,
  hasSystemConfigWriteCapability,
  resolveAgentCapabilityIds,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
  type AgentPolicyToolkitOptions,
  type ContextCacheKit,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  composeObsidianCapabilityHooks,
  formatObsidianRoutineHint,
} from "../runtime-agents/obsidian/hooks.js";
import { mergeRuntimeCacheHooks } from "../policies/context-cache-runtime.js";
import {
  createDefaultRuntimeAgentPolicy,
  type DefaultRuntimePolicyOptions,
} from "../policies/runtime-agent-policy.js";
import type { PersonalCapabilityDeps } from "../runtime-agents/personal-capability-deps.js";
import { OBSIDIAN_VAULT_CAPABILITY_ID } from "../runtime-agents/obsidian/tools.js";

type RuntimeHookToolkit = {
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
  contextCache?: ContextCacheKit | undefined;
  skillCatalog?: SkillCatalog | undefined;
};

const hasObsidianVaultCapability = (definition: RuntimeAgentDefinition): boolean =>
  resolveAgentCapabilityIds(definition).includes(OBSIDIAN_VAULT_CAPABILITY_ID);

const defaultErrorMessage = (error: unknown, definition: RuntimeAgentDefinition): string =>
  `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`;

const systemConfigErrorMessage = (error: unknown): string =>
  `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`;

const obsidianErrorMessage = (error: unknown): string =>
  `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`;

const createSystemConfigHooks = (
  definition: RuntimeAgentDefinition,
  toolkit: RuntimeHookToolkit,
): RuntimeAgentNodeHooks =>
  mergeRuntimeCacheHooks(
    createSystemAgentNodeHooks(toolkit.shellFormatters),
    definition,
    toolkit.shellFormatters,
    toolkit.skillCatalog,
    toolkit.contextCache,
  );

const createDefaultHooks = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  toolkit: RuntimeHookToolkit,
): RuntimeAgentNodeHooks =>
  mergeRuntimeCacheHooks(
    shellHooks,
    definition,
    toolkit.shellFormatters,
    toolkit.skillCatalog,
    toolkit.contextCache,
  );

/** Obsidian hooks: vault extras in cache; prefer cache prompt/model hooks when caching. */
const createObsidianHooks = (
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  toolkit: RuntimeHookToolkit,
): RuntimeAgentNodeHooks => {
  const { shellFormatters, contextCache, skillCatalog } = toolkit;

  const cacheHooks = mergeRuntimeCacheHooks(
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
  // resultMapping stays on obsidianHooks (spread first).
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
};

export type PersonalRuntimeNodeConfigOptions = {
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
  contextCache?: ContextCacheKit | undefined;
  skillCatalog?: SkillCatalog | undefined;
  vaultRoot?: string;
};

/**
 * Full node config (hooks + labels) for a definition.
 * Test/helper surface — mirrors the three-way case split in createPersonalRuntimeAgentPolicy.
 */
export const buildPersonalRuntimeAgentNodeConfig = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: PersonalRuntimeNodeConfigOptions,
): RuntimeAgentNodeConfig => {
  const toolkit: RuntimeHookToolkit = {
    shellFormatters: options.shellFormatters,
    ...(options.contextCache !== undefined ? { contextCache: options.contextCache } : {}),
    ...(options.skillCatalog !== undefined ? { skillCatalog: options.skillCatalog } : {}),
  };

  if (hasSystemConfigWriteCapability(definition)) {
    return {
      ...createSystemConfigHooks(definition, toolkit),
      logLabel: "runtime-agent",
      buildErrorMessage: (error) => systemConfigErrorMessage(error),
    };
  }

  if (
    options.vaultRoot
    && hasObsidianVaultCapability(definition)
  ) {
    return {
      ...createObsidianHooks(options.vaultRoot, definition, shellHooks, toolkit),
      logLabel: "runtime-agent",
      buildErrorMessage: (error) => obsidianErrorMessage(error),
    };
  }

  return {
    ...createDefaultHooks(definition, shellHooks, toolkit),
    logLabel: "runtime-agent",
    buildErrorMessage: (error, agentDefinition) => defaultErrorMessage(error, agentDefinition),
  };
};

/**
 * Personal runtime policy: system-config + Obsidian (when vault root is closed over) + default.
 * Finalize salvage comes from hooks.resultMapping (system-config / Obsidian composers).
 */
export const createPersonalRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
  vaultRoot?: string,
): RuntimeAgentPolicy => {
  if (!vaultRoot) {
    return createDefaultRuntimeAgentPolicy(shellHooks, options);
  }

  return createAgentPolicy<PersonalCapabilityDeps>({
    resolveDeps: (context, definition) => resolveSystemConfigDeps(context, definition),
    unavailableMessage: () => SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) => {
      const { definition } = deps;
      const toolkit: RuntimeHookToolkit = {
        shellFormatters: policyOptions.shellFormatters!,
        contextCache: options.contextCache,
        skillCatalog: options.skillCatalog,
      };

      if (hasSystemConfigWriteCapability(definition)) {
        return createSystemConfigHooks(definition, toolkit);
      }

      if (hasObsidianVaultCapability(definition)) {
        return createObsidianHooks(vaultRoot, definition, shellHooks, toolkit);
      }

      return createDefaultHooks(definition, shellHooks, toolkit);
    },
    logLabel: "runtime-agent",
    buildErrorMessage: (error, definition) => {
      if (hasSystemConfigWriteCapability(definition)) {
        return systemConfigErrorMessage(error);
      }

      if (hasObsidianVaultCapability(definition)) {
        return obsidianErrorMessage(error);
      }

      return defaultErrorMessage(error, definition);
    },
  }, options);
};
