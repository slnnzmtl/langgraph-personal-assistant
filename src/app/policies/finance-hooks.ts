import { AIMessage, HumanMessage } from "@langchain/core/messages";

import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { resolveTurnTools } from "../../core/execution/create-sub-agent.js";
import { appendConfiguredSkillAttachments } from "../../runtime-agents/skill-attachments.js";
import {
  financeToolBatchBindOptions,
  meetsFinanceToolBatchRequirement,
  resolveFinanceToolBatchPlan,
} from "../../runtime-agents/policies/finance/tool-batches.js";

export const createFinanceNodeHooks = (): RuntimeAgentNodeHooks => ({
  logLabel: "finance-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to complete finance sync: ${error instanceof Error ? error.message : "Unknown error during finance sync"}`,
  buildSystemPrompt: (ctx) => {
    const batchPlan = resolveFinanceToolBatchPlan(ctx.state.messages);
    const promptWithAttachments = appendConfiguredSkillAttachments(
      ctx.basePrompt,
      ctx.definition,
      ctx.state.messages,
    );

    if (!batchPlan) {
      return promptWithAttachments;
    }

    return `${promptWithAttachments}\n\n<required_tool_batch>\n${batchPlan.instruction}\n</required_tool_batch>`;
  },
  resolveToolsForTurn: (ctx) => {
    if (!ctx.tools) {
      return [];
    }

    const batchPlan = resolveFinanceToolBatchPlan(ctx.state.messages);
    return resolveTurnTools(ctx.tools, ctx.state.messages, batchPlan
      ? {
          restrictToNames: batchPlan.allowedFunctionNames,
          alwaysInclude: ["read_skill"],
        }
      : undefined);
  },
  getBindToolsOptions: (ctx) => {
    const batchPlan = resolveFinanceToolBatchPlan(ctx.state.messages);
    return batchPlan ? financeToolBatchBindOptions(batchPlan) : undefined;
  },
  afterModelInvoke: async (ctx, { response, promptMessages, modelForTurn }) => {
    const batchPlan = resolveFinanceToolBatchPlan(ctx.state.messages);

    if (
      !batchPlan
      || batchPlan.requiredCount <= 1
      || meetsFinanceToolBatchRequirement(batchPlan, response.tool_calls?.length ?? 0)
    ) {
      return response;
    }

    const retryMessages = [
      ...promptMessages,
      response,
      new HumanMessage(
        `You must call all required tools in one response: ${batchPlan.allowedFunctionNames.join(", ")}.`,
      ),
    ];

    const retryResponse = await modelForTurn.invoke(retryMessages);
    if (!(retryResponse instanceof AIMessage)) {
      throw new Error("Finance LLM model must return an AI message.");
    }

    return retryResponse;
  },
  processResponse: (_ctx, response) => response,
});
