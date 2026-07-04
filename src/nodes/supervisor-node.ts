import { AIMessage, SystemMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import { MVPRoutingSchema, type RoutingDecision } from "../routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

const supervisorPrompt = new SystemMessage(`
You are the Root Supervisor for a private personal assistant.
Your only job is to inspect the user's latest request and choose the next route.

Routing rules:
- Use Finance_SG for money, expenses, transactions, budgets, banking, or finance logging.
- Use Obsidian_SG for notes, markdown, writing to a vault, summaries, or documentation.
- Use FINISH for general chat, clarifications, or when you can answer directly without a specialized sub-graph.

When you choose FINISH, always provide a concise helpful reply in the reply field.
`);

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
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