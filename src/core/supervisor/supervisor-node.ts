import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import { stripToolsForSupervisor } from "./message-history.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import {
  buildSupervisorRoutingSchema,
  type RoutingDecision,
} from "./routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import {
  createResolveAgentId,
  detectCompletionState,
  resolveRoutingDecision,
  tryCronRouteUpdate,
} from "./helpers.js";

export type CronTriggerResolver = {
  resolveCronTriggerRoute: (message: BaseMessage | undefined) => string | undefined;
  superviseCronRoute: string;
};

export type SupervisorNodeOptions = {
  runtimeAgentRepository?: RuntimeAgentRepository;
  loadSupervisorPrompt: () => string;
  cronTriggerResolver?: CronTriggerResolver;
  resolveAgentId?: (routeOrId: string) => string;
};

const buildFailureReply = async (
  llmConnector: ILLMConnector,
  promptMessages: BaseMessage[],
  supervisorPromptText: string,
  failureContext: string,
): Promise<string> => {
  const fallbackResponse = await llmConnector.getModel().invoke([
    new SystemMessage(
      `${supervisorPromptText}\nThe normal supervisor routing failed. Produce the final user-facing reply in plain text. Explain the issue briefly and helpfully, and do not output JSON or call tools. Failure context: ${failureContext}`,
    ),
    ...promptMessages.slice(1),
  ]);

  const fallbackText = extractMessageTextContent(fallbackResponse.content).trim();

  if (fallbackText.length > 0) {
    return fallbackText;
  }

  throw new Error("Supervisor final reply model returned an empty response.");
};

export const createSupervisorNode = (
  llmConnector: ILLMConnector,
  options: SupervisorNodeOptions,
) =>
  async (state: AgentState): Promise<AgentStateUpdate> => {
    const resolveAgentId = createResolveAgentId(options.resolveAgentId);
    const supervisorPromptText = options.loadSupervisorPrompt();
    const supervisorPrompt = new SystemMessage(supervisorPromptText);
    const lastMessage = state.messages[state.messages.length - 1];
    const cronRoute = options.cronTriggerResolver?.resolveCronTriggerRoute(lastMessage);

    const cronRouteUpdate = tryCronRouteUpdate(
      cronRoute,
      options.cronTriggerResolver?.superviseCronRoute,
      resolveAgentId,
    );

    if (cronRouteUpdate) {
      return cronRouteUpdate;
    }

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

    const completionUpdate = detectCompletionState(state, promptMessages);

    if (completionUpdate) {
      return completionUpdate;
    }

    await logSystemPromptInvocation("supervisor-system-prompt", rawPromptMessages);

    const runtimeAgents = options.runtimeAgentRepository
      ? await options.runtimeAgentRepository.loadAgents()
      : [];
    const enabledAgentIds = new Set(
      runtimeAgents.filter((agent) => agent.enabled).map((agent) => agent.id),
    );
    const routingSchema = buildSupervisorRoutingSchema(runtimeAgents);
    const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(routingSchema);

    const buildFailureUpdate = async (failureContext: string): Promise<AgentStateUpdate> => ({
      next: "FINISH",
      messages: [
        new AIMessage(
          await buildFailureReply(
            llmConnector,
            promptMessages,
            supervisorPromptText,
            failureContext,
          ),
        ),
      ],
    });

    let response: RoutingDecision;

    try {
      response = await routingChain.invoke(promptMessages);
    } catch (error) {
      console.warn("Supervisor routing structured output failed:", error);
      const failureMessage = error instanceof Error ? error.message : String(error);

      return buildFailureUpdate(`Structured routing failed: ${failureMessage}`);
    }

    console.log("Supervisor routing decision:", response.next, response.reply);

    return resolveRoutingDecision(
      response,
      enabledAgentIds,
      resolveAgentId,
      buildFailureUpdate,
    );
  };
