import {
  createAgentPolicy,
  createSystemAgentNodeHooks,
  mapConfigurationSubAgentResult,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_CAPABILITY_ID,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
  hasSystemConfigWriteCapability,
  type AgentPolicyToolkitOptions,
  type AgentStateUpdate,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
  type SkillCatalog,
  type SubAgentState,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityCatalog } from "@personal-assistant/supervisor-framework";
import type { ContextCacheKit } from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../runtime-agents/system-capability-deps.js";
import type { PersonalResolveTools } from "../runtime-agents/resolve-tools.js";
import { mergeRuntimeCacheHooks } from "./context-cache-runtime.js";

export type RuntimeCapabilityBehavior = {
  logLabel: string;
  buildErrorMessage: (error: unknown, definition: RuntimeAgentDefinition) => string;
  createHooks: (ctx: {
    definition: RuntimeAgentDefinition;
    capabilityDeps: PersonalCapabilityDeps;
    shellHooks: RuntimeAgentNodeHooks;
    shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>;
  }) => RuntimeAgentNodeHooks;
  selectToolsForTurn?: RuntimeAgentNodeConfig["selectToolsForTurn"];
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
};

export type DefaultRuntimePolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
  contextCache?: ContextCacheKit;
};

const defaultBehavior = (
  shellHooks: RuntimeAgentNodeHooks,
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]> | undefined,
  contextCache: ContextCacheKit | undefined,
  skillCatalog: SkillCatalog | undefined,
): RuntimeCapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error, definition) =>
    `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
  createHooks: ({ definition }) => {
    if (!shellFormatters) {
      return shellHooks;
    }

    return mergeRuntimeCacheHooks(shellHooks, definition, shellFormatters, skillCatalog, contextCache);
  },
});

const systemConfigBehavior = (
  shellFormatters: NonNullable<AgentPolicyToolkitOptions["shellFormatters"]>,
  contextCache: ContextCacheKit | undefined,
  skillCatalog: SkillCatalog | undefined,
): RuntimeCapabilityBehavior => ({
  logLabel: "runtime-agent",
  buildErrorMessage: (error) =>
    `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  createHooks: ({ definition }) =>
    mergeRuntimeCacheHooks(
      createSystemAgentNodeHooks(shellFormatters),
      definition,
      shellFormatters,
      skillCatalog,
      contextCache,
    ),
  mapResult: (result, { maxSteps, name }) => mapConfigurationSubAgentResult(result, maxSteps, name),
});

const requireShellFormatters = (
  shellFormatters: AgentPolicyToolkitOptions["shellFormatters"] | undefined,
  capabilityId: string,
): NonNullable<AgentPolicyToolkitOptions["shellFormatters"]> => {
  if (!shellFormatters) {
    throw new Error(`${capabilityId} hooks require runtime shell formatters.`);
  }

  return shellFormatters;
};

/** Resolve which capability (if any) supplies optional hooks for this agent. */
export const resolveCapabilityHookId = (
  definition: RuntimeAgentDefinition,
): string | undefined => {
  if (hasSystemConfigWriteCapability(definition)) {
    return SYSTEM_CONFIG_CAPABILITY_ID;
  }

  return undefined;
};

export type ResolveCapabilityBehaviorOptions = {
  shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"] | undefined;
  contextCache?: ContextCacheKit | undefined;
  skillCatalog?: SkillCatalog | undefined;
};

/** System-configuration and default runtime behavior only (no product-domain hooks). */
export const resolveCapabilityBehavior = (
  definition: RuntimeAgentDefinition,
  shellHooks: RuntimeAgentNodeHooks,
  options: ResolveCapabilityBehaviorOptions = {},
): RuntimeCapabilityBehavior => {
  const { shellFormatters, contextCache, skillCatalog } = options;
  const hookCapabilityId = resolveCapabilityHookId(definition);

  if (hookCapabilityId === SYSTEM_CONFIG_CAPABILITY_ID) {
    return systemConfigBehavior(
      requireShellFormatters(shellFormatters, hookCapabilityId),
      contextCache,
      skillCatalog,
    );
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
    ...(shellFormatters !== undefined ? { shellFormatters } : {}),
    ...(policyOptions?.contextCache !== undefined
      ? { contextCache: policyOptions.contextCache }
      : {}),
    ...(policyOptions?.skillCatalog !== undefined
      ? { skillCatalog: policyOptions.skillCatalog }
      : {}),
  });

  return {
    logLabel: behavior.logLabel,
    buildErrorMessage: behavior.buildErrorMessage,
    ...(behavior.selectToolsForTurn ? { selectToolsForTurn: behavior.selectToolsForTurn } : {}),
  };
};

/**
 * Default runtime policy: shared shell hooks + system-configuration LLM hooks.
 * Product-domain hooks (e.g. Obsidian) are composed in personal-pack / personal-runtime-policy.
 */
export const createDefaultRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
): RuntimeAgentPolicy => {
  const behaviorFor = (
    definition: RuntimeAgentDefinition,
    shellFormatters?: AgentPolicyToolkitOptions["shellFormatters"],
  ): RuntimeCapabilityBehavior =>
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
