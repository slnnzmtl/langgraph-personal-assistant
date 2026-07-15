import { AIMessage, HumanMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";
import { hasPendingToolCalls } from "../../tools/routing.js";
import type { FinanceState, FinanceStateUpdate } from "./state.js";
import {
  financeToolBatchBindOptions,
  meetsFinanceToolBatchRequirement,
  resolveFinanceToolBatchPlan,
} from "./tool-batches.js";

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

  const bindTools = model.bindTools.bind(model);
  const boundTools = tools || [];

  return async (state: FinanceState): Promise<FinanceStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.messages)) {
        return { financeStepCount: state.financeStepCount };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const financeStepCount = isLoopContinuation
        ? state.financeStepCount + 1
        : 1;

      const batchPlan = resolveFinanceToolBatchPlan(state.messages);
      const systemPrompt = batchPlan
        ? `${loadFinanceSystemPrompt()}\n\n<required_tool_batch>\n${batchPlan.instruction}\n</required_tool_batch>`
        : loadFinanceSystemPrompt();
      const systemInstructions = new SystemMessage(systemPrompt);
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);
      const modelForTurn = batchPlan
        ? bindTools(boundTools, financeToolBatchBindOptions(batchPlan))
        : bindTools(boundTools);

      await logSystemPromptInvocation("finance-system-prompt", promptMessages);

      let response = await modelForTurn.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      if (
        batchPlan
        && batchPlan.requiredCount > 1
        && !meetsFinanceToolBatchRequirement(batchPlan, response.tool_calls?.length ?? 0)
      ) {
        const retryMessages = mergeMessageRuns([
          ...promptMessages,
          response,
          new HumanMessage(
            `You must call all required tools in one response: ${batchPlan.allowedFunctionNames.join(", ")}.`,
          ),
        ]);
        response = await modelForTurn.invoke(retryMessages);
        if (!(response instanceof AIMessage)) {
          throw new Error("Finance LLM model must return an AI message.");
        }
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
