import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { loadSupervisorSystemPrompt } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { sanitizeHistoryForGemini } from "./message-history.js";

const LATEST_USER_REQUEST_KEY = "latestUserRequest";
const OBSIDIAN_HANDOFF_KEY = "obsidianHandoff";

const getLatestUserRequest = (state: AgentState): string => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];

    if (message instanceof HumanMessage) {
      return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    }
  }

  const cachedRequest = state.context[LATEST_USER_REQUEST_KEY];
  if (typeof cachedRequest === "string" && cachedRequest.trim().length > 0) {
    return cachedRequest;
  }

  throw new Error("No user message found for routing.");
};

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const currentDatetime = new Date().toISOString();
    const latestMessage = state.messages[state.messages.length - 1];
    const hasObsidianHandoff = state.context[OBSIDIAN_HANDOFF_KEY] === true;

    if (hasObsidianHandoff && latestMessage instanceof AIMessage) {
      return {
        next: "FINISH",
        context: {
          [LATEST_USER_REQUEST_KEY]: getLatestUserRequest(state),
          [OBSIDIAN_HANDOFF_KEY]: false,
        },
      };
    }

    const latestUserRequest = getLatestUserRequest(state);
    const supervisorPrompt = new SystemMessage(
      `${loadSupervisorSystemPrompt()}

Current datetime: ${currentDatetime}`,
    );

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = sanitizeHistoryForGemini(rawPromptMessages);

    await logSystemPromptInvocation("supervisor-system-prompt", rawPromptMessages);

    const response = await routingChain.invoke(promptMessages);

    if (response.next === "FINISH") {
      return {
        next: response.next,
        messages: [
          new AIMessage(
            response.reply ?? "I can help with that once you give me a bit more detail.",
          ),
        ],
        context: { [LATEST_USER_REQUEST_KEY]: latestUserRequest },
      };
    }

    return {
      next: response.next,
      context: { [LATEST_USER_REQUEST_KEY]: latestUserRequest },
    };
  };
};