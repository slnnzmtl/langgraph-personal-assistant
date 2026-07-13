import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Annotation } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../../mcp/supabase/index.js";
import { loadFinanceSystemPrompt } from "../../prompts/load-system-prompt.js";
import { reduceAgentMessages } from "../../state.js";
import { createFinanceTools } from "./tools/index.js";

// An expense row must have an id, a name, and a paid_date (which category rows lack).
type ExpenseRecord = { id: string | number; name: string; paid_date: string; [key: string]: unknown };

export const FinanceStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  financeStepCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  financeExpenseSelection: Annotation<ExpenseRecord[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});

export type FinanceState = typeof FinanceStateAnnotation.State;
export type FinanceStateUpdate = typeof FinanceStateAnnotation.Update;

const isExpenseRecord = (v: unknown): v is ExpenseRecord => {
  const r = v as Record<string, unknown>;
  return !!v
    && typeof v === "object"
    && (typeof r.id === "string" || typeof r.id === "number")
    && typeof r.name === "string"
    && typeof r.paid_date === "string";
};

const parseExpenseArray = (content: unknown): ExpenseRecord[] | undefined => {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isExpenseRecord)) {
      return parsed;
    }
  } catch {
    // not valid JSON — ignore
  }
  return undefined;
};

export const findLatestExpenseContinuation = (messages: BaseMessage[]): ExpenseRecord[] | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!(msg instanceof ToolMessage) || msg.name !== "exec_sql") continue;
    const rows = parseExpenseArray(msg.content);
    if (rows) return rows;
  }
  return undefined;
};

const getExpenseContinuation = (state: FinanceState): ExpenseRecord[] | undefined =>
  findLatestExpenseContinuation(state.messages) ?? (state.financeExpenseSelection.length > 0 ? state.financeExpenseSelection : undefined);

const buildFinanceSystemInstructions = (continuation: ExpenseRecord[] | undefined): string => {
  const base = loadFinanceSystemPrompt();
  if (!continuation) return base;
  return `${base}\n\n<latest_expense_selection>\n${JSON.stringify(continuation)}\n</latest_expense_selection>`;
};

/**
 * Create a finance node that calls the LLM with finance tools.
 * Tool calls are generated here but executed by a separate ToolNode.
 * 
 * @param model The LLM to use for finance operations
 * @param tools The finance tools to bind to the model
 * @returns A node function compatible with LangGraph StateGraph
 */
export const createFinanceNode = (model: BaseChatModel, tools: StructuredToolInterface[]) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Finance LLM model must support tool calling.");
  }

  const modelWithTools = model.bindTools(tools);

  return async (state: FinanceState): Promise<FinanceStateUpdate> => {
    try {
      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const financeStepCount = isLoopContinuation
        ? state.financeStepCount + 1
        : 1;

      const continuation = getExpenseContinuation(state);
      const systemInstructions = new SystemMessage(buildFinanceSystemInstructions(continuation));
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("finance-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Finance LLM model must return an AI message.");
      }

      return {
        messages: [response],
        financeStepCount,
        financeExpenseSelection: continuation ?? [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      return {
        messages: [new AIMessage(`Unable to complete finance sync: ${errorMessage}`)],
      };
    }
  };
};
