import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { resolveCronTriggerRoute, SUPERVISE_CRON_ROUTE } from "../cron-triggers.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { loadSupervisorSystemPrompt } from "../prompts/load-system-prompt.js";
import type { RuntimeAgentRepository } from "../runtime-agents/repository.js";
import { RUNTIME_AGENT_CONTEXT_KEY, resolveRuntimeAgentId } from "../runtime-agents/types.js";
import {
  buildSupervisorRoutingSchema,
  type RoutingDecision,
} from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { extractMessageTextContent, stripToolsForSupervisor } from "./message-history.js";

type SupervisorNodeOptions = {
  runtimeAgentRepository?: RuntimeAgentRepository;
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

const routeToRuntimeAgent = (agentId: string): AgentStateUpdate => ({
  next: "Runtime_SG",
  context: {
    [RUNTIME_AGENT_CONTEXT_KEY]: agentId,
  },
});

export const createSupervisorNode = (
  llmConnector: ILLMConnector,
  options?: SupervisorNodeOptions,
) =>
  async (state: AgentState): Promise<AgentStateUpdate> => {
    const supervisorPromptText = loadSupervisorSystemPrompt();
    const supervisorPrompt = new SystemMessage(supervisorPromptText);
    const cronRoute = resolveCronTriggerRoute(state.messages[state.messages.length - 1]);

    if (cronRoute && cronRoute !== SUPERVISE_CRON_ROUTE) {
      return routeToRuntimeAgent(resolveRuntimeAgentId(cronRoute));
    }

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

    const lastStripped = promptMessages[promptMessages.length - 1];
    const lastStrippedText = lastStripped instanceof AIMessage
      ? extractMessageTextContent(lastStripped.content).trim()
      : "";
    const isSubAgentComplete =
      lastStripped instanceof AIMessage
      && (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0)
      && lastStrippedText.length > 0;

    if (isSubAgentComplete) {
      return { next: "FINISH" };
    }

    const hasDelegatedToRuntimeAgent = state.messages.some((message) => message instanceof AIMessage);
    const hadRecentToolResult = state.messages.some((message) => {
      if (!(message instanceof ToolMessage)) {
        return false;
      }

      return extractMessageTextContent(message.content).trim().length > 0;
    });
    if (
      hasDelegatedToRuntimeAgent
      && !hadRecentToolResult
      && lastStripped instanceof AIMessage
      && (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0)
      && lastStrippedText.length === 0
    ) {
      return {
        next: "FINISH",
        messages: [new AIMessage("Completed your request.")],
      };
    }

    await logSystemPromptInvocation("supervisor-system-prompt", rawPromptMessages);

    const runtimeAgents = options?.runtimeAgentRepository
      ? await options.runtimeAgentRepository.loadAgents()
      : [];
    const enabledAgentIds = new Set(
      runtimeAgents.filter((agent) => agent.enabled).map((agent) => agent.id),
    );
    const routingSchema = buildSupervisorRoutingSchema(runtimeAgents);
    const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(routingSchema);

    let response: RoutingDecision;

    try {
      response = await routingChain.invoke(promptMessages);
    } catch (error) {
      console.warn("Supervisor routing structured output failed:", error);
      const failureMessage = error instanceof Error ? error.message : String(error);

      return {
        next: "FINISH",
        messages: [
          new AIMessage(
            await buildFailureReply(
              llmConnector,
              promptMessages,
              supervisorPromptText,
              `Structured routing failed: ${failureMessage}`,
            ),
          ),
        ],
      };
    }

    console.log("Supervisor routing decision:", response.next, response.reply);

    if (response.next === "FINISH") {
      if (typeof response.reply !== "string" || response.reply.trim().length === 0) {
        return {
          next: "FINISH",
          messages: [
            new AIMessage(
              await buildFailureReply(
                llmConnector,
                promptMessages,
                supervisorPromptText,
                "The routing model returned FINISH without a reply.",
              ),
            ),
          ],
        };
      }

      return {
        next: response.next,
        messages: [new AIMessage(response.reply)],
      };
    }

    const agentId = resolveRuntimeAgentId(response.next);

    if (!enabledAgentIds.has(agentId)) {
      return {
        next: "FINISH",
        messages: [
          new AIMessage(
            await buildFailureReply(
              llmConnector,
              promptMessages,
              supervisorPromptText,
              `Unknown or disabled runtime agent route: ${response.next}`,
            ),
          ),
        ],
      };
    }

    return routeToRuntimeAgent(agentId);
  };
