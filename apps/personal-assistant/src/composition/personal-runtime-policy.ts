import { AIMessage } from "@langchain/core/messages";

import {
  buildDirectoryTree,
  hasSystemConfigWriteCapability,
  resolveAgentCapabilityIds,
  type AgentPolicyToolkitOptions,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
} from "@personal-assistant/supervisor-framework";
import {
  composeObsidianCapabilityHooks,
  formatObsidianRoutineHint,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "../runtime-agents/obsidian/hooks.js";
import { mergeRuntimeCacheHooks } from "../policies/context-cache-runtime.js";
import {
  createDefaultRuntimeAgentPolicy,
  createRuntimeAgentPolicyFromBehavior,
  nodeConfigFromBehavior,
  resolveCapabilityBehavior,
  type DefaultRuntimePolicyOptions,
  type ResolveCapabilityBehaviorOptions,
  type RuntimeCapabilityBehavior,
} from "../policies/runtime-agent-policy.js";
import type { PersonalCapabilityDeps } from "../runtime-agents/personal-capability-deps.js";
import { OBSIDIAN_VAULT_CAPABILITY_ID } from "../runtime-agents/obsidian/tools.js";

const createObsidianCapabilityBehavior = (
  vaultRoot: string,
  shellHooks: RuntimeAgentNodeHooks,
  options: {
    shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
    contextCache: ResolveCapabilityBehaviorOptions["contextCache"];
    skillCatalog: ResolveCapabilityBehaviorOptions["skillCatalog"];
  },
): RuntimeCapabilityBehavior => {
  const { shellFormatters, contextCache, skillCatalog } = options;

  return {
    logLabel: "runtime-agent",
    buildErrorMessage: (error) =>
      `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
    createHooks: ({ definition }) => {
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
  };
};

const hasObsidianVaultCapability = (definition: RuntimeAgentDefinition): boolean =>
  resolveAgentCapabilityIds(definition).includes(OBSIDIAN_VAULT_CAPABILITY_ID);

/** System-config wins; then Obsidian when vault is closed over; else default. */
const resolveBehavior = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: ResolveCapabilityBehaviorOptions,
  vaultRoot: string | undefined,
): RuntimeCapabilityBehavior => {
  if (
    vaultRoot
    && !hasSystemConfigWriteCapability(definition)
    && hasObsidianVaultCapability(definition)
  ) {
    const shellFormatters = options.shellFormatters;
    if (!shellFormatters) {
      throw new Error(`${OBSIDIAN_VAULT_CAPABILITY_ID} hooks require runtime shell formatters.`);
    }

    return createObsidianCapabilityBehavior(vaultRoot, shellHooks, {
      shellFormatters,
      contextCache: options.contextCache,
      skillCatalog: options.skillCatalog,
    });
  }

  return resolveCapabilityBehavior(definition, shellHooks, options);
};

export type PersonalRuntimeNodeConfigOptions = {
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
  contextCache?: ResolveCapabilityBehaviorOptions["contextCache"];
  skillCatalog?: ResolveCapabilityBehaviorOptions["skillCatalog"];
  vaultRoot?: string;
  capabilityDeps?: PersonalCapabilityDeps;
};

/**
 * Full node config (hooks + labels) for a definition.
 * Test/helper surface — not a parallel resolver triad.
 */
export const buildPersonalRuntimeAgentNodeConfig = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: PersonalRuntimeNodeConfigOptions,
): RuntimeAgentNodeConfig => {
  const behaviorOptions: ResolveCapabilityBehaviorOptions = {
    shellFormatters: options.shellFormatters,
    ...(options.contextCache !== undefined ? { contextCache: options.contextCache } : {}),
    ...(options.skillCatalog !== undefined ? { skillCatalog: options.skillCatalog } : {}),
  };
  const behavior = resolveBehavior(
    definition,
    shellHooks,
    behaviorOptions,
    options.vaultRoot,
  );
  const hooks = behavior.createHooks({
    definition,
    capabilityDeps: options.capabilityDeps ?? ({} as PersonalCapabilityDeps),
    shellHooks,
    shellFormatters: options.shellFormatters,
  });

  return {
    ...hooks,
    ...nodeConfigFromBehavior(behavior),
  };
};

/**
 * Personal runtime policy: system-config + Obsidian (when vault root is closed over) + default.
 */
export const createPersonalRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
  vaultRoot?: string,
): RuntimeAgentPolicy => {
  if (!vaultRoot) {
    return createDefaultRuntimeAgentPolicy(shellHooks, options);
  }

  return createRuntimeAgentPolicyFromBehavior(
    shellHooks,
    options,
    (definition, shellFormatters) =>
      resolveBehavior(
        definition,
        shellHooks,
        {
          shellFormatters: shellFormatters ?? options.shellFormatters,
          contextCache: options.contextCache,
          skillCatalog: options.skillCatalog,
        },
        vaultRoot,
      ),
  );
};
