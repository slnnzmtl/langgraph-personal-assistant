import { AIMessage, SystemMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { loadSupervisorSystemPrompt } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { extractMessageTextContent, stripToolsForSupervisor } from "./message-history.js";

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const supervisorPrompt = new SystemMessage(loadSupervisorSystemPrompt());

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

    const response = await routingChain.invoke(promptMessages);

    console.log("Supervisor routing decision:", response.next, response.reply);

    if (response.next === "FINISH") {
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