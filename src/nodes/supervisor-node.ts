import { AIMessage, SystemMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { createPromptLoader, SUPERVISOR_SYSTEM_PROMPT_PATH } from "../prompts/load-system-prompt.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  const loadSupervisorPrompt = createPromptLoader(SUPERVISOR_SYSTEM_PROMPT_PATH);
  const supervisorPrompt = new SystemMessage(loadSupervisorPrompt());
  const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(MVPRoutingSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    const promptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];

    await logSystemPromptInvocation("supervisor-system-prompt", promptMessages);

    const response = (await routingChain.invoke(promptMessages)) as RoutingDecision;

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