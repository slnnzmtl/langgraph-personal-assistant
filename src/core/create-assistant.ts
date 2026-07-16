import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { CronJobRepository, RuntimeCronService } from "../cron/types.js";
import { createRuntimeAgentDispatcher } from "./agents/dispatch.js";
import { createPromptResolver, type PromptResolver } from "./agents/prompt-resolver.js";
import type { RuntimeAgentRepository } from "./agents/repository.js";
import { createRuntimeAgentExecutionContext } from "./execution/context.js";
import { createGenericPolicy, type GenericPolicyDeps } from "./policies/generic.js";
import { createPolicyRegistry, type PolicyRegistry } from "./policies/registry.js";
import type { RuntimeAgentPolicy } from "./types/policy.js";
import { createSupervisorNode } from "./supervisor/supervisor-node.js";
import { AgentStateAnnotation, type AgentState, type RouteName } from "./state.js";

export type AssistantConfig = {
  supervisorLlm: ILLMConnector;
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  runtimeAgentRepository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps?: Record<string, unknown>;
  loadPromptByKey?: (key: string) => string;
  loadSupervisorPrompt: () => string;
  policies?: RuntimeAgentPolicy[];
  genericPolicyDeps?: GenericPolicyDeps;
  cronTriggerResolver?: Parameters<typeof createSupervisorNode>[1]["cronTriggerResolver"];
  resolveAgentId?: (routeOrId: string) => string;
  checkpointer?: MemorySaver;
  graphName?: string;
  promptResolver?: PromptResolver;
  policyRegistry?: PolicyRegistry;
};

export const createAssistant = (config: AssistantConfig) => {
  const promptResolver = config.promptResolver
    ?? (config.loadPromptByKey
      ? createPromptResolver(config.loadPromptByKey)
      : (() => { throw new Error("createAssistant requires promptResolver or loadPromptByKey."); })());

  const policyRegistry = config.policyRegistry
    ?? (config.policies && config.genericPolicyDeps
      ? createPolicyRegistry([
        createGenericPolicy(config.genericPolicyDeps),
        ...config.policies,
      ])
      : (() => { throw new Error("createAssistant requires policyRegistry or policies with genericPolicyDeps."); })());

  const memory = config.checkpointer ?? new MemorySaver();
  const executionContext = createRuntimeAgentExecutionContext({
    models: config.models,
    ...(config.defaultModelKey ? { defaultModelKey: config.defaultModelKey } : {}),
    repository: config.runtimeAgentRepository,
    cronJobRepository: config.cronJobRepository,
    ...(config.runtimeCron ? { runtimeCron: config.runtimeCron } : {}),
    ...(config.bundleDeps ? { bundleDeps: config.bundleDeps } : {}),
    promptResolver,
    policyRegistry,
  });

  const supervisorNode = createSupervisorNode(config.supervisorLlm, {
    runtimeAgentRepository: config.runtimeAgentRepository,
    loadSupervisorPrompt: config.loadSupervisorPrompt,
    ...(config.cronTriggerResolver ? { cronTriggerResolver: config.cronTriggerResolver } : {}),
    ...(config.resolveAgentId ? { resolveAgentId: config.resolveAgentId } : {}),
  });

  const runtimeAgentDispatcher = createRuntimeAgentDispatcher(executionContext);

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("Runtime_SG", runtimeAgentDispatcher);

  graph
    .addEdge(START, "supervisor")
    .addConditionalEdges(
      "supervisor",
      (state: AgentState) => state.next ?? "FINISH",
      {
        Runtime_SG: "Runtime_SG",
        FINISH: END,
      } satisfies Record<RouteName, "Runtime_SG" | typeof END>,
    );

  graph.addEdge("Runtime_SG", "supervisor");

  return graph.compile({
    checkpointer: memory,
    name: config.graphName ?? "personal-assistant",
  });
};
