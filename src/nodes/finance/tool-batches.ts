import { ToolMessage, type BaseMessage } from "@langchain/core/messages";

export type FinanceToolBatchPlan = {
  allowedFunctionNames: string[];
  requiredCount: number;
  instruction: string;
};

const sliceSinceLastHuman = (messages: BaseMessage[]): BaseMessage[] => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?._getType() === "human") {
      return messages.slice(index + 1);
    }
  }

  return messages;
};

export const resolveFinanceToolBatchPlan = (messages: BaseMessage[]): FinanceToolBatchPlan | undefined => {
  const toolMessages = messages.filter((message): message is ToolMessage => message instanceof ToolMessage);
  const lastTool = toolMessages.at(-1);

  if (!lastTool) {
    return undefined;
  }

  if (lastTool.name === "read_skill") {
    return {
      allowedFunctionNames: ["get_categories", "fetch_wise_transactions"],
      requiredCount: 2,
      instruction:
        "Required batch: call get_categories AND fetch_wise_transactions together in this single model turn. " +
        "Emit both tool calls before any insert or user-facing summary.",
    };
  }

  const turnMessages = sliceSinceLastHuman(messages);
  const turnTools = turnMessages.filter((message): message is ToolMessage => message instanceof ToolMessage);
  const hasCategories = turnTools.some((message) => message.name === "get_categories");
  const hasTransactions = turnTools.some((message) => message.name === "fetch_wise_transactions");
  const hasExecSql = turnTools.some((message) => message.name === "exec_sql");

  if (
    hasCategories
    && hasTransactions
    && !hasExecSql
    && (lastTool.name === "get_categories" || lastTool.name === "fetch_wise_transactions")
  ) {
    return {
      allowedFunctionNames: ["exec_sql"],
      requiredCount: 1,
      instruction:
        "Required next step: run exec_sql using the categories and transactions already fetched. " +
        "Do not call get_categories or fetch_wise_transactions again.",
    };
  }

  return undefined;
};

export const financeToolBatchBindOptions = (plan: FinanceToolBatchPlan) => ({
  tool_choice: "any" as const,
  allowedFunctionNames: plan.allowedFunctionNames,
});

export const meetsFinanceToolBatchRequirement = (
  plan: FinanceToolBatchPlan,
  toolCallCount: number,
): boolean => toolCallCount >= plan.requiredCount;
