import { AIMessage, SystemMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { loadSupervisorSystemPrompt } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { stripToolsForSupervisor } from "./message-history.js";

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const currentDatetime = new Date().toISOString();
    const supervisorPrompt = new SystemMessage(
      `${loadSupervisorSystemPrompt()}

Current datetime: ${currentDatetime}`,
    );

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

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
      };
    }

    return {
      next: response.next,
    };
  };
};