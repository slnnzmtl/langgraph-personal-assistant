import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { createUnavailableGraphBundle } from "../agents/runtime-agent-graph-bundle.js";
import { resolveModel, type RuntimeAgentExecutionContext } from "../execution/context.js";
import {
  createSubAgentGraphBundle,
  mapDefaultSubAgentResult,
} from "../execution/create-sub-agent.js";
import {
  createRuntimeAgentNode,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type SubAgentToolSource,
} from "../execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../execution/sub-agent-state.js";
import type { AgentStateUpdate } from "../state.js";
import type { SkillCatalog } from "../skills/catalog.js";
import type { RuntimeShellFormatters } from "../system-context.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import { resolveAgentModelKey } from "../types/agent.js";
import type { RuntimeAgentPolicy } from "../types/policy.js";

export type AgentPolicyToolkitOptions = {
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

export type AgentPolicyCapabilityDeps<
  TCapabilityDeps extends Record<string, unknown>,
  TExtra extends Record<string, unknown>,
> = {
  model: BaseChatModel;
  definition: RuntimeAgentDefinition;
  capabilityDeps: TCapabilityDeps;
  skillCatalog?: SkillCatalog;
} & TExtra;

export type CreateAgentPolicyConfig<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
  TExtra extends Record<string, unknown> = Record<string, never>,
> = {
  displayName?: string;
  requireShellFormatters?: boolean;
  resolveDeps?: (context: RuntimeAgentExecutionContext<TCapabilityDeps>, definition: RuntimeAgentDefinition) => TExtra | null;
  unavailableMessage?: (reason: string) => string;
  resolveTools: (
    definition: RuntimeAgentDefinition,
    capabilityDeps: TCapabilityDeps,
    options: { skillCatalog?: SkillCatalog },
  ) => StructuredToolInterface[];
  hooks?: RuntimeAgentNodeHooks;
  createHooks?: (
    deps: AgentPolicyCapabilityDeps<TCapabilityDeps, TExtra>,
    options: AgentPolicyToolkitOptions,
  ) => RuntimeAgentNodeHooks;
  logLabel?: string;
  buildErrorMessage?: RuntimeAgentNodeConfig["buildErrorMessage"];
  selectToolsForTurn?: RuntimeAgentNodeConfig["selectToolsForTurn"];
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
  resolveMapResult?: (
    definition: RuntimeAgentDefinition,
  ) => ((
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate) | undefined;
};

const createAgentLlmNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  nodeConfig: RuntimeAgentNodeConfig,
) =>
  createRuntimeAgentNode(model, definition, tools, nodeConfig) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createAgentPolicy = <
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
  TExtra extends Record<string, unknown> = Record<string, never>,
>(
  config: CreateAgentPolicyConfig<TCapabilityDeps, TExtra>,
  options: AgentPolicyToolkitOptions = {},
): RuntimeAgentPolicy => ({
  createGraphBundle: (context, definition) => {
    const policyContext = context as RuntimeAgentExecutionContext<TCapabilityDeps>;
    const policyLabel = config.displayName ?? definition.name;
    const needsHooks = config.createHooks !== undefined;
    if (config.requireShellFormatters !== false && needsHooks && !options.shellFormatters) {
      throw new Error(`createAgentPolicy(${policyLabel}) requires runtime shell formatters.`);
    }

    const resolvedExtra = config.resolveDeps?.(policyContext, definition) ?? ({} as TExtra);

    if (config.resolveDeps && resolvedExtra === null) {
      const displayName = config.displayName ?? definition.name;
      return createUnavailableGraphBundle(
        displayName,
        config.unavailableMessage?.("required dependencies are not configured.")
          ?? `${displayName} is unavailable because required dependencies are not configured.`,
      );
    }

    const deps: AgentPolicyCapabilityDeps<TCapabilityDeps, TExtra> = {
      model: resolveModel(policyContext, resolveAgentModelKey(definition)),
      definition,
      capabilityDeps: policyContext.capabilityDeps,
      ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
      ...resolvedExtra,
    };

    const hooks = config.createHooks
      ? config.createHooks(deps, options)
      : (config.hooks ?? {});

    const nodeConfig: RuntimeAgentNodeConfig = {
      ...hooks,
      ...(policyContext.promptLogging ? { promptLogging: policyContext.promptLogging } : {}),
      ...(config.logLabel ? { logLabel: config.logLabel } : {}),
      ...(config.buildErrorMessage ? { buildErrorMessage: config.buildErrorMessage } : {}),
      ...(config.selectToolsForTurn ? { selectToolsForTurn: config.selectToolsForTurn } : {}),
    };

    const mapResult = config.resolveMapResult?.(definition)
      ?? config.mapResult
      ?? ((result, mapConfig) => mapDefaultSubAgentResult(result, mapConfig));

    return createSubAgentGraphBundle({
      name: config.displayName ?? definition.name,
      maxSteps: definition.maxSteps,
      deps,
      createTools: (agentDeps) =>
        config.resolveTools(agentDeps.definition, agentDeps.capabilityDeps, {
          ...(agentDeps.skillCatalog ? { skillCatalog: agentDeps.skillCatalog } : {}),
        }),
      createLlmNode: (agentDeps, agentTools) =>
        createAgentLlmNode(agentDeps.model, agentDeps.definition, agentTools, nodeConfig),
      mapResult,
    });
  },
});

/** Alias for the default runtime agent loop builder (prepare → llm ⇄ tools → finalize). */
export const createRuntimeAgentBundle = createAgentPolicy;
