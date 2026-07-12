import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { resolveSchedulerTriggerRoute, SUPERVISE_SCHEDULER_ROUTE } from "../cron/cron-launcher.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { loadSupervisorSystemPrompt } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { extractMessageTextContent, stripToolsForSupervisor } from "./message-history.js";

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

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const supervisorPromptText = loadSupervisorSystemPrompt();
    const supervisorPrompt = new SystemMessage(supervisorPromptText);
    const schedulerRoute = resolveSchedulerTriggerRoute(state.messages[state.messages.length - 1]);

    if (schedulerRoute && schedulerRoute !== SUPERVISE_SCHEDULER_ROUTE) {
      return { next: schedulerRoute };
    }

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

    // If the last message after stripping is a complete AI text response (no pending tool calls),
    // a sub-agent has already handled the request — finish without an extra LLM call.
    const lastStripped = promptMessages[promptMessages.length - 1];
    const isSubAgentComplete =
      lastStripped instanceof AIMessage &&
      (!lastStripped.tool_calls || lastStripped.tool_calls.length === 0) &&
      extractMessageTextContent(lastStripped.content).trim().length > 0;

    if (isSubAgentComplete) {
      return { next: "FINISH" };
    }

    await logSystemPromptInvocation("supervisor-system-prompt", rawPromptMessages);

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
        const failureContext = "The routing model returned FINISH without a reply.";

        return {
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
        };
      }

      return {
        next: response.next,
        messages: [
          new AIMessage(
            response.reply!
          ),
        ],
      };
    }

    return {
      next: response.next,
    };
  };
};