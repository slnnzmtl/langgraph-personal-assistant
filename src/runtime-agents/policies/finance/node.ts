import { AIMessage, HumanMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { logSystemPromptInvocation } from "../../../logging/system-prompt-logger.js";
import { hasPendingToolCalls } from "../../../tools/routing.js";
import type { SkillScopedToolContext } from "../../../tools/skill-scoped-registry.js";
import {
  isSkillScopedToolContext,
  resolveTurnTools,
  type SubAgentToolSource,
} from "../../execution/create-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../execution/sub-agent-state.js";
import { resolveRuntimeAgentSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentDefinition } from "../../types.js";
import { appendConfiguredSkillAttachments } from "../../skill-attachments.js";
import {
  financeToolBatchBindOptions,
  meetsFinanceToolBatchRequirement,
  resolveFinanceToolBatchPlan,
} from "./tool-batches.js";

export const createFinanceNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools?: SubAgentToolSource,
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Finance LLM model must support tool calling.");
  }

  const bindTools = model.bindTools.bind(model);
  const basePrompt = resolveRuntimeAgentSystemPrompt(definition);

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.messages)) {
        return { stepCount: state.stepCount };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const stepCount = isLoopContinuation
        ? state.stepCount + 1
        : 1;

      const batchPlan = resolveFinanceToolBatchPlan(state.messages);
      const toolsForTurn = tools
        ? resolveTurnTools(tools, state.messages, batchPlan
          ? {
              restrictToNames: batchPlan.allowedFunctionNames,
              alwaysInclude: ["read_skill"],
            }
          : undefined)
        : [];

      const promptWithAttachments = appendConfiguredSkillAttachments(basePrompt, definition, state.messages);
      const systemPrompt = batchPlan
        ? `${promptWithAttachments}\n\n<required_tool_batch>\n${batchPlan.instruction}\n</required_tool_batch>`
        : promptWithAttachments;
      const systemInstructions = new SystemMessage(systemPrompt);
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);
      const modelForTurn = batchPlan
        ? bindTools(toolsForTurn, financeToolBatchBindOptions(batchPlan))
        : bindTools(toolsForTurn);

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
        stepCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during finance sync";
      return {
        messages: [new AIMessage(`Unable to complete finance sync: ${errorMessage}`)],
      };
    }
  };
};

export const getFinanceToolsForTurn = (
  toolSource: SkillScopedToolContext,
  messages: SubAgentState["messages"],
): StructuredToolInterface[] => {
  const batchPlan = resolveFinanceToolBatchPlan(messages);
  return resolveTurnTools(toolSource, messages, batchPlan
    ? {
        restrictToNames: batchPlan.allowedFunctionNames,
        alwaysInclude: ["read_skill"],
      }
    : undefined);
};

export const financeUsesSkillScopedTools = (
  tools: SubAgentToolSource | undefined,
): tools is SkillScopedToolContext =>
  tools !== undefined && isSkillScopedToolContext(tools);
