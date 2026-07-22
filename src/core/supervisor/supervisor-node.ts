import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../ports/llm-connector.js";
import { noopPromptLogging, type PromptLoggingHook } from "../ports/prompt-logging.js";
import { stripToolsForSupervisor } from "./message-history.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  type RoutingDecision,
} from "./routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { EMPTY_REPLY_ROUTE, FAILURE_REPLY_ROUTE } from "../state.js";
import {
  detectCompletionState,
  needsEmptySubAgentSummary,
  resolveRoutingDecision,
  tryCronRouteUpdate,
} from "./helpers.js";

export type CronTriggerResolver = {
  resolveCronTriggerRoute: (message: BaseMessage | undefined) => string | undefined;
  superviseCronRoute: string;
};

export type SupervisorNodeOptions = {
  runtimeAgentRepository?: RuntimeAgentRepository;
  wiredAgentIds: ReadonlySet<string>;
  loadSupervisorPrompt: () => string;
  promptLogging?: PromptLoggingHook;
  cronTriggerResolver?: CronTriggerResolver;
};

export const createSupervisorNode = (
  llmConnector: ILLMConnector,
  options: SupervisorNodeOptions,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const promptLogging = options.promptLogging ?? noopPromptLogging;
    const supervisorPromptText = options.loadSupervisorPrompt();
    const supervisorPrompt = new SystemMessage(supervisorPromptText);
    const lastMessage = state.messages[state.messages.length - 1];
    const cronRoute = options.cronTriggerResolver?.resolveCronTriggerRoute(lastMessage);

    const cronRouteUpdate = tryCronRouteUpdate(
      cronRoute,
      options.cronTriggerResolver?.superviseCronRoute,
      options.wiredAgentIds,
    );

    if (cronRouteUpdate) {
      return cronRouteUpdate;
    }

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

    if (needsEmptySubAgentSummary(state)) {
      return { next: EMPTY_REPLY_ROUTE };
    }

    const completionUpdate = detectCompletionState(state);

    if (completionUpdate) {
      return completionUpdate;
    }

    await promptLogging("supervisor-system-prompt", rawPromptMessages);

    const runtimeAgents = options.runtimeAgentRepository
      ? await options.runtimeAgentRepository.loadAgents()
      : [];
    const routableAgents = filterRoutableRuntimeAgents(runtimeAgents, options.wiredAgentIds);
    const enabledAgentIds = new Set(routableAgents.map((agent) => agent.id));
    const routingSchema = buildSupervisorRoutingSchema(runtimeAgents, options.wiredAgentIds);
    const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(routingSchema);

    const buildFailureUpdate = async (failureContext: string): Promise<AgentStateUpdate> => ({
      next: FAILURE_REPLY_ROUTE,
      routingFailureContext: failureContext,
      lastHandoff: null,
    });

    let response: RoutingDecision;

    try {
      response = await routingChain.invoke(promptMessages, config);
    } catch (error) {
      console.warn("Supervisor routing structured output failed:", error);
      const failureMessage = error instanceof Error ? error.message : String(error);

      return buildFailureUpdate(`Structured routing failed: ${failureMessage}`);
    }

    if (response.next === "FINISH") {
      console.log("Supervisor routing decision:", response.next, response.reply);
    } else {
      console.log("Supervisor routing decision:", response.next);
    }

    return resolveRoutingDecision(
      response,
      enabledAgentIds,
      buildFailureUpdate,
    );
  };
