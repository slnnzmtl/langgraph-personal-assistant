import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { formatCurrentTime } from "../../utils/datetime.js";
import { hasPendingToolCalls } from "../../tools/routing.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "./sub-agent-state.js";
import {
  buildRuntimeAgentPromptMessages,
  isEmptyModelResponse,
} from "./sub-agent-messages.js";

export type SubAgentToolSource = StructuredToolInterface[];

const filterToolsByNames = (
  tools: StructuredToolInterface[],
  allowedNames: string[],
  options?: { alwaysInclude?: string[] },
): StructuredToolInterface[] => {
  const allowed = new Set([
    ...allowedNames,
    ...(options?.alwaysInclude ?? []),
  ]);

  return tools.filter((tool) => allowed.has(tool.name));
};

export const resolveTurnTools = (
  toolSource: SubAgentToolSource,
  _messages: BaseMessage[],
  options?: {
    restrictToNames?: string[];
    alwaysInclude?: string[];
  },
): StructuredToolInterface[] => {
  if (!options?.restrictToNames) {
    return toolSource;
  }

  const filterOptions = options.alwaysInclude
    ? { alwaysInclude: options.alwaysInclude }
    : undefined;

  return filterToolsByNames(toolSource, options.restrictToNames, filterOptions);
};

export type RuntimeAgentTurnContext = {
  state: SubAgentState;
  definition: RuntimeAgentDefinition;
  tools: SubAgentToolSource | undefined;
  stepCount: number;
  isLoopContinuation: boolean;
  basePrompt: string;
  allowedToolNames: Set<string>;
};

export type RuntimeAgentNodeHooks = {
  logLabel?: string;
  buildErrorMessage?: (error: unknown, definition: RuntimeAgentDefinition) => string;
  beforeTurn?: (ctx: RuntimeAgentTurnContext) => Promise<SubAgentStateUpdate | null | undefined>;
  buildSystemPrompt?: (ctx: RuntimeAgentTurnContext) => Promise<string> | string;
  resolveToolsForTurn?: (ctx: RuntimeAgentTurnContext) => StructuredToolInterface[];
  getBindToolsOptions?: (ctx: RuntimeAgentTurnContext) => Record<string, unknown> | undefined;
  afterModelInvoke?: (
    ctx: RuntimeAgentTurnContext,
    args: {
      response: AIMessage;
      promptMessages: BaseMessage[];
      modelForTurn: Runnable;
      model: BaseChatModel;
      toolsForTurn: StructuredToolInterface[];
    },
  ) => Promise<AIMessage>;
  processResponse?: (ctx: RuntimeAgentTurnContext, response: AIMessage) => AIMessage;
  emptyResponseMessage?: (definition: RuntimeAgentDefinition) => string;
};

export const sanitizeResponseToolCalls = (
  response: AIMessage,
  allowedToolNames: Set<string>,
  unavailableMessage = "That tool is not available for this runtime agent.",
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
  return new AIMessage(responseText.length > 0 ? responseText : unavailableMessage);
};

const defaultBuildSystemPrompt = (
  definition: RuntimeAgentDefinition,
  basePrompt: string,
): string => {
  const currentDatetime = formatCurrentTime(new Date());
  const header = [
    "<system_metadata>",
    `CURRENT DATETIME: ${currentDatetime}`,
    `RUNTIME_AGENT: ${definition.name}`,
    "</system_metadata>",
  ].join("\n");

  return `${header}\n\n${basePrompt.trim()}`;
};

export const createRuntimeAgentNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  hooks: RuntimeAgentNodeHooks = {},
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Runtime agent LLM model must support tool calling.");
  }

  const bindTools = model.bindTools.bind(model);
  const toolSource = tools;
  const basePrompt = definition.systemPrompt.trim();

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.messages)) {
        return { stepCount: state.stepCount };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;

      const ctx: RuntimeAgentTurnContext = {
        state,
        definition,
        tools: toolSource,
        stepCount,
        isLoopContinuation,
        basePrompt,
        allowedToolNames: new Set(),
      };

      const beforeTurnResult = hooks.beforeTurn ? await hooks.beforeTurn(ctx) : null;
      if (beforeTurnResult) {
        return beforeTurnResult;
      }

      const toolsForTurn = hooks.resolveToolsForTurn
        ? hooks.resolveToolsForTurn(ctx)
        : toolSource
          ? resolveTurnTools(toolSource, state.messages)
          : [];

      ctx.allowedToolNames = new Set(toolsForTurn.map((tool) => tool.name));

      const systemPromptText = hooks.buildSystemPrompt
        ? await hooks.buildSystemPrompt(ctx)
        : defaultBuildSystemPrompt(definition, basePrompt);

      const systemInstructions = new SystemMessage(systemPromptText);
      const promptMessages = buildRuntimeAgentPromptMessages(systemInstructions, state.messages);

      await logSystemPromptInvocation(hooks.logLabel ?? `runtime-agent-${definition.id}`, promptMessages);

      const bindOptions = hooks.getBindToolsOptions?.(ctx);
      const modelForTurn = toolsForTurn.length > 0
        ? (bindOptions ? bindTools(toolsForTurn, bindOptions) : bindTools(toolsForTurn))
        : model;

      let response: AIMessage = await modelForTurn.invoke(promptMessages);

      if (
        isEmptyModelResponse(response)
        && isLoopContinuation
        && toolsForTurn.length > 0
        && !hooks.afterModelInvoke
      ) {
        response = await modelForTurn.invoke(promptMessages);
      }

      if (!(response instanceof AIMessage)) {
        throw new Error("Runtime agent LLM model must return an AI message.");
      }

      if (hooks.afterModelInvoke) {
        response = await hooks.afterModelInvoke(ctx, {
          response,
          promptMessages,
          modelForTurn,
          model,
          toolsForTurn,
        });
        if (!(response instanceof AIMessage)) {
          throw new Error("Runtime agent LLM model must return an AI message.");
        }
      }

      const processed = hooks.processResponse
        ? hooks.processResponse(ctx, response)
        : sanitizeResponseToolCalls(response, ctx.allowedToolNames);

      const responseText = extractMessageTextContent(processed.content).trim();
      const toolCalls = processed.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && responseText.length === 0) {
        const fallback = hooks.emptyResponseMessage?.(definition)
          ?? `The ${definition.name} agent did not produce a response. Please try again.`;
        return { messages: [new AIMessage(fallback)], stepCount };
      }

      return { messages: [processed], stepCount };
    } catch (error) {
      if (hooks.buildErrorMessage) {
        return { messages: [new AIMessage(hooks.buildErrorMessage(error, definition))] };
      }

      const message = error instanceof Error ? error.message : "Unknown error during runtime agent execution";
      return { messages: [new AIMessage(`Unable to run runtime agent ${definition.name}: ${message}`)] };
    }
  };
};

export const createRuntimeAgentFailureMessage = (text: string): AIMessage => new AIMessage(text);
