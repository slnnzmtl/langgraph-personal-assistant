import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";
import type { FinanceState, FinanceStateUpdate } from "./state.js";

/**
 * Create a finance node that calls the LLM with finance tools.
 * Tool calls are generated here but executed by a separate ToolNode.
 * 
 * @param model The LLM to use for finance operations
 * @param tools The finance tools to bind to the model (or leave undefined to create them)
 * @returns A node function compatible with LangGraph StateGraph
 */
export const createFinanceNode = (
  model: BaseChatModel,
  tools?: StructuredToolInterface[],
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Finance LLM model must support tool calling.");
  }

  const modelWithTools = model.bindTools(tools || []);

  return async (state: FinanceState): Promise<FinanceStateUpdate> => {
    try {
      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const financeStepCount = isLoopContinuation
        ? state.financeStepCount + 1
        : 1;

      const systemInstructions = new SystemMessage(loadFinanceSystemPrompt());
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("finance-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      return {
        messages: [response],
        financeStepCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      return {
        messages: [new AIMessage(`Unable to complete finance sync: ${errorMessage}`)],
      };
    }
  };
};
