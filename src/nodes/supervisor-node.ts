import { AIMessage, HumanMessage, SystemMessage, mergeMessageRuns } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { createPromptLoader, SUPERVISOR_SYSTEM_PROMPT_PATH } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

const getLatestUserRequest = (state: AgentState): string => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];

    if (message instanceof HumanMessage) {
      return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    }
  }

  throw new Error("No user message found for routing.");
};

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const loadSupervisorPrompt = createPromptLoader(SUPERVISOR_SYSTEM_PROMPT_PATH);
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const currentDatetime = new Date().toISOString();
    const latestUserRequest = getLatestUserRequest(state);
    const supervisorPrompt = new SystemMessage(
      `${loadSupervisorPrompt()}

Current datetime: ${currentDatetime}`,
    );
    const routingAnchor = new HumanMessage(
      `Route based primarily on this latest user request:\n${latestUserRequest}`,
    );

    const promptMessages = mergeMessageRuns([
      supervisorPrompt,
      ...state.messages,
      routingAnchor,
    ]);

    await logSystemPromptInvocation("supervisor-system-prompt", promptMessages);

    const response = await routingChain.invoke(promptMessages);

    if (response.next === "FINISH") {
      return {
        next: response.next,
        messages: [
          new AIMessage(
            response.reply ?? "I can help with that once you give me a bit more detail.",
          ),
        ],
      };
    }

    return {
      next: response.next,
    };
  };
};