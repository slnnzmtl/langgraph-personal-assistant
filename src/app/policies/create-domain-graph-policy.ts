import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { resolveModel } from "../../core/execution/context.js";
import type { PolicyContext } from "../../core/types/policy-context.js";
import { createSubAgentGraphBundle } from "../../core/execution/create-sub-agent.js";
import { createUnavailableGraphBundle } from "../../core/agents/runtime-agent-graph-bundle.js";
import {
  createRuntimeAgentNode,
  type RuntimeAgentNodeHooks,
  type SubAgentToolSource,
} from "../../core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../core/execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentModelKey } from "../../core/types/agent.js";
import { createRuntimeAgentPolicy } from "../../core/types/policy.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";
import type { AgentStateUpdate } from "../../core/state.js";
import { resolveAgentCapabilityTools } from "../composition/resolve-agent-tools.js";

export type DomainPolicyOptions = {
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

type DomainPolicyDeps<TDeps> = {
  model: BaseChatModel;
  definition: RuntimeAgentDefinition;
  bundleDeps: RuntimeToolBundleDeps;
  skillCatalog?: SkillCatalog;
} & TDeps;

type CreateDomainGraphPolicyConfig<TDeps> = {
  executor: string;
  displayName: string;
  requireShellFormatters?: boolean;
  resolveDeps: (context: PolicyContext, definition: RuntimeAgentDefinition) => TDeps | null;
  unavailableMessage?: (reason: string) => string;
  createHooks: (
    deps: DomainPolicyDeps<TDeps>,
    options: DomainPolicyOptions,
  ) => RuntimeAgentNodeHooks;
  mapResult?: (
    result: SubAgentState,
    config: { maxSteps: number; name: string },
  ) => AgentStateUpdate;
};

const createDomainLlmNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  hooks: RuntimeAgentNodeHooks,
) =>
  createRuntimeAgentNode(model, definition, tools, hooks) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createDomainGraphPolicy = <TDeps extends Record<string, unknown>>(
  config: CreateDomainGraphPolicyConfig<TDeps>,
  options: DomainPolicyOptions = {},
) =>
  createRuntimeAgentPolicy(config.executor, (context, definition) => {
    if (config.requireShellFormatters !== false && !options.shellFormatters) {
      throw new Error(`createDomainGraphPolicy(${config.executor}) requires runtime shell formatters.`);
    }

    const resolvedDeps = config.resolveDeps(context, definition);

    if (!resolvedDeps) {
      return createUnavailableGraphBundle(
        config.displayName,
        config.unavailableMessage?.("required dependencies are not configured.")
          ?? `${config.displayName} is unavailable because required dependencies are not configured.`,
      );
    }

    const deps: DomainPolicyDeps<TDeps> = {
      model: resolveModel(context, resolveAgentModelKey(definition)),
      definition,
      bundleDeps: context.bundleDeps as RuntimeToolBundleDeps,
      ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
      ...resolvedDeps,
    };

    return createSubAgentGraphBundle({
      name: config.displayName,
      maxSteps: definition.maxSteps,
      deps,
      createTools: (agentDeps) =>
        resolveAgentCapabilityTools(agentDeps.definition, agentDeps.bundleDeps, {
          ...(agentDeps.skillCatalog ? { skillCatalog: agentDeps.skillCatalog } : {}),
        }),
      createLlmNode: (agentDeps, tools) =>
        createDomainLlmNode(
          agentDeps.model,
          agentDeps.definition,
          tools,
          config.createHooks(agentDeps, options),
        ),
      ...(config.mapResult ? { mapResult: config.mapResult } : {}),
    });
  });

export const createMaxStepsResultMapper = (
  agentLabel: string,
  buildMessage: (maxSteps: number) => string,
) =>
  (result: SubAgentState, { maxSteps }: { maxSteps: number; name: string }): AgentStateUpdate => {
    if (result.stepCount >= maxSteps) {
      return {
        messages: [new AIMessage(buildMessage(maxSteps))],
      };
    }

    const lastMessage = result.agentMessages[result.agentMessages.length - 1];
    return {
      messages: [lastMessage as AIMessage],
    };
  };
