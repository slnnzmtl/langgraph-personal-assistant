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

export type AgentPolicyBundleDeps<
  TBundleDeps extends Record<string, unknown>,
  TExtra extends Record<string, unknown>,
> = {
  model: BaseChatModel;
  definition: RuntimeAgentDefinition;
  bundleDeps: TBundleDeps;
  skillCatalog?: SkillCatalog;
} & TExtra;

export type CreateAgentPolicyConfig<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
  TExtra extends Record<string, unknown> = Record<string, never>,
> = {
  /** Selects optional LLM hooks; tools always come from capabilityIds. */
  executor: string;
  displayName?: string;
  requireShellFormatters?: boolean;
  resolveDeps?: (context: RuntimeAgentExecutionContext<TBundleDeps>, definition: RuntimeAgentDefinition) => TExtra | null;
  unavailableMessage?: (reason: string) => string;
  resolveTools: (
    definition: RuntimeAgentDefinition,
    bundleDeps: TBundleDeps,
    options: { skillCatalog?: SkillCatalog },
  ) => StructuredToolInterface[];
  hooks?: RuntimeAgentNodeHooks;
  createHooks?: (
    deps: AgentPolicyBundleDeps<TBundleDeps, TExtra>,
    options: AgentPolicyToolkitOptions,
  ) => RuntimeAgentNodeHooks;
  logLabel?: string;
  buildErrorMessage?: RuntimeAgentNodeConfig["buildErrorMessage"];
  selectToolsForTurn?: RuntimeAgentNodeConfig["selectToolsForTurn"];
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
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
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
  TExtra extends Record<string, unknown> = Record<string, never>,
>(
  config: CreateAgentPolicyConfig<TBundleDeps, TExtra>,
  options: AgentPolicyToolkitOptions = {},
): RuntimeAgentPolicy => ({
  executor: config.executor,
  createGraphBundle: (context, definition) => {
    const policyContext = context as RuntimeAgentExecutionContext<TBundleDeps>;
    const needsHooks = config.createHooks !== undefined;
    if (config.requireShellFormatters !== false && needsHooks && !options.shellFormatters) {
      throw new Error(`createAgentPolicy(${config.executor}) requires runtime shell formatters.`);
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

    const deps: AgentPolicyBundleDeps<TBundleDeps, TExtra> = {
      model: resolveModel(policyContext, resolveAgentModelKey(definition)),
      definition,
      bundleDeps: policyContext.bundleDeps,
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

    return createSubAgentGraphBundle({
      name: config.displayName ?? definition.name,
      maxSteps: definition.maxSteps,
      deps,
      createTools: (agentDeps) =>
        config.resolveTools(agentDeps.definition, agentDeps.bundleDeps, {
          ...(agentDeps.skillCatalog ? { skillCatalog: agentDeps.skillCatalog } : {}),
        }),
      createLlmNode: (agentDeps, agentTools) =>
        createAgentLlmNode(agentDeps.model, agentDeps.definition, agentTools, nodeConfig),
      mapResult: config.mapResult ?? ((result, mapConfig) => mapDefaultSubAgentResult(result, mapConfig)),
    });
  },
});
