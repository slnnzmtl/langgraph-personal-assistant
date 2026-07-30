import { AIMessage } from "@langchain/core/messages";

import {
  buildDirectoryTree,
  createAgentPolicy,
  resolveAgentCapabilityIds,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
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
  resolveCapabilityBehavior,
  resolveCapabilityHookId,
  type DefaultRuntimePolicyOptions,
  type ResolveCapabilityBehaviorOptions,
  type RuntimeCapabilityBehavior,
} from "../policies/runtime-agent-policy.js";
import type { PersonalCapabilityDeps } from "../runtime-agents/system-capability-deps.js";
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

/** System-config first; then Obsidian when vault is closed over; else default. */
export const resolvePersonalCapabilityHookId = (
  definition: RuntimeAgentDefinition,
  vaultRoot: string | undefined,
): string | undefined => {
  const systemOrUndefined = resolveCapabilityHookId(definition);
  if (systemOrUndefined) {
    return systemOrUndefined;
  }

  if (vaultRoot && hasObsidianVaultCapability(definition)) {
    return OBSIDIAN_VAULT_CAPABILITY_ID;
  }

  return undefined;
};

export const resolvePersonalCapabilityBehavior = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: ResolveCapabilityBehaviorOptions = {},
  vaultRoot?: string,
): RuntimeCapabilityBehavior => {
  const hookId = resolvePersonalCapabilityHookId(definition, vaultRoot);

  if (hookId === OBSIDIAN_VAULT_CAPABILITY_ID && vaultRoot) {
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

export const buildPersonalRuntimeAgentNodeConfigForDefinition = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
  policyOptions?: Pick<DefaultRuntimePolicyOptions, "contextCache" | "skillCatalog">,
  vaultRoot?: string,
): RuntimeAgentNodeConfig => {
  const behavior = resolvePersonalCapabilityBehavior(
    definition,
    shellHooks,
    {
      ...(shellFormatters !== undefined ? { shellFormatters } : {}),
      ...(policyOptions?.contextCache !== undefined
        ? { contextCache: policyOptions.contextCache }
        : {}),
      ...(policyOptions?.skillCatalog !== undefined
        ? { skillCatalog: policyOptions.skillCatalog }
        : {}),
    },
    vaultRoot,
  );

  return {
    logLabel: behavior.logLabel,
    buildErrorMessage: behavior.buildErrorMessage,
    ...(behavior.selectToolsForTurn ? { selectToolsForTurn: behavior.selectToolsForTurn } : {}),
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

  const behaviorFor = (
    definition: RuntimeAgentDefinition,
    shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
  ): RuntimeCapabilityBehavior =>
    resolvePersonalCapabilityBehavior(
      definition,
      shellHooks,
      {
        shellFormatters: shellFormatters ?? options.shellFormatters,
        contextCache: options.contextCache,
        skillCatalog: options.skillCatalog,
      },
      vaultRoot,
    );

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
