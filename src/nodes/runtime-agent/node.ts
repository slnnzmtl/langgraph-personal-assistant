import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { formatCurrentTime } from "../../utils/datetime.js";
import { hasPendingToolCalls } from "../../tools/routing.js";
import { extractMessageTextContent } from "../message-history.js";
import type { SubAgentState, SubAgentStateUpdate } from "../sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../runtime-agents/types.js";

const buildRuntimeSystemPrompt = (definition: RuntimeAgentDefinition): string => {
  const currentDatetime = formatCurrentTime(new Date());
  const header = [
    "<system_metadata>",
    `CURRENT DATETIME: ${currentDatetime}`,
    `RUNTIME_AGENT: ${definition.name}`,
    "</system_metadata>",
  ].join("\n");

  return `${header}\n\n${definition.systemPrompt.trim()}`;
};

const sanitizeResponseToolCalls = (
  response: AIMessage,
  allowedToolNames: Set<string>,
): AIMessage => {
  const toolCalls = response.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return response;
  }

  const validCalls = toolCalls.filter((call) => call.name && allowedToolNames.has(call.name));
  if (validCalls.length === toolCalls.length) {
    return response;
  }

  if (validCalls.length > 0) {
    return new AIMessage({
      content: response.content,
      tool_calls: validCalls,
    });
  }

  const responseText = extractMessageTextContent(response.content).trim();
  return new AIMessage(
    responseText.length > 0
      ? responseText
      : "That tool is not available for this runtime agent.",
  );
};

export const createRuntimeAgentNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: StructuredToolInterface[],
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Runtime agent LLM model must support tool calling.");
  }

  const bindTools = model.bindTools.bind(model);
  const allowedToolNames = new Set(tools.map((tool) => tool.name));

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.messages)) {
        return { stepCount: state.stepCount };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;

      const systemInstructions = new SystemMessage(buildRuntimeSystemPrompt(definition));
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation(`runtime-agent-${definition.id}`, promptMessages);

      const modelForTurn = tools.length > 0 ? bindTools(tools) : model;
      const response = await modelForTurn.invoke(promptMessages);

      if (!(response instanceof AIMessage)) {
        throw new Error("Runtime agent LLM model must return an AI message.");
      }

      const sanitizedResponse = sanitizeResponseToolCalls(response, allowedToolNames);
      const responseText = extractMessageTextContent(sanitizedResponse.content).trim();
      const toolCalls = sanitizedResponse.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && responseText.length === 0) {
        return {
          messages: [new AIMessage(`Completed the ${definition.name} task.`)],
          stepCount,
        };
      }

      return { messages: [sanitizedResponse], stepCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error during runtime agent execution";
      return { messages: [new AIMessage(`Unable to run runtime agent ${definition.name}: ${message}`)] };
    }
  };
};

export const createRuntimeAgentFailureMessage = (text: string): AIMessage => new AIMessage(text);
