import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import {
  defaultAppendDynamicSections,
  type SystemContextFormatter,
} from "../system-context.js";
import { hasPendingToolCalls } from "./tool-routing.js";
import { extractMessageTextContent } from "../messages/message-content.js";
import type { RuntimeAgentDefinition } from "../types/agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "./sub-agent-state.js";
import {
  buildRecoveryPromptMessages,
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
  beforeTurn?: (ctx: RuntimeAgentTurnContext) => Promise<SubAgentStateUpdate | null | undefined>;
  buildSystemPrompt?: (ctx: RuntimeAgentTurnContext) => Promise<string> | string;
  processResponse?: (ctx: RuntimeAgentTurnContext, response: AIMessage) => AIMessage;
};

export type RuntimeAgentNodeConfig = RuntimeAgentNodeHooks & {
  logLabel?: string;
  buildErrorMessage?: (error: unknown, definition: RuntimeAgentDefinition) => string;
  selectToolsForTurn?: (
    ctx: RuntimeAgentTurnContext,
    tools: StructuredToolInterface[],
  ) => StructuredToolInterface[];
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

const defaultFormatSystemMetadata: SystemContextFormatter = (date, options) => {
  const lines = [
    "<system_metadata>",
    `CURRENT DATETIME: ${date.toISOString()}`,
  ];

  if (options?.runtimeAgent) {
    lines.push(`RUNTIME_AGENT: ${options.runtimeAgent}`);
  }

  lines.push("</system_metadata>");
  return lines.join("\n");
};

const defaultBuildSystemPrompt = (
  definition: RuntimeAgentDefinition,
  basePrompt: string,
  formatSystemMetadata: SystemContextFormatter = defaultFormatSystemMetadata,
): string =>
  defaultAppendDynamicSections(
    basePrompt.trim(),
    formatSystemMetadata(new Date(), { runtimeAgent: definition.name }),
  );

const defaultBuildErrorMessage = (error: unknown, definition: RuntimeAgentDefinition): string => {
  const message = error instanceof Error ? error.message : "Unknown error during runtime agent execution";
  return `Unable to run runtime agent ${definition.name}: ${message}`;
};

export const createRuntimeAgentNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  config: RuntimeAgentNodeConfig = {},
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Runtime agent LLM model must support tool calling.");
  }

  const bindTools = model.bindTools.bind(model);
  const toolSource = tools;
  const basePrompt = definition.systemPrompt.trim();
  const logLabel = config.logLabel ?? `runtime-agent-${definition.id}`;
  const buildErrorMessage = config.buildErrorMessage ?? defaultBuildErrorMessage;

  return async (state: SubAgentState, runnableConfig?: RunnableConfig): Promise<SubAgentStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.agentMessages)) {
        return { stepCount: state.stepCount };
      }

      const lastMessage = state.agentMessages[state.agentMessages.length - 1];
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

      const beforeTurnResult = config.beforeTurn ? await config.beforeTurn(ctx) : null;
      if (beforeTurnResult) {
        return beforeTurnResult;
      }

      const baseToolsForTurn = toolSource
        ? resolveTurnTools(toolSource, state.agentMessages)
        : [];
      const toolsForTurn = config.selectToolsForTurn
        ? config.selectToolsForTurn(ctx, baseToolsForTurn)
        : baseToolsForTurn;

      ctx.allowedToolNames = new Set(toolsForTurn.map((tool) => tool.name));

      const systemPromptText = config.buildSystemPrompt
        ? await config.buildSystemPrompt(ctx)
        : defaultBuildSystemPrompt(definition, basePrompt);

      const systemInstructions = new SystemMessage(systemPromptText);
      const promptMessages = buildRuntimeAgentPromptMessages(systemInstructions, state.agentMessages);

      await logSystemPromptInvocation(logLabel, promptMessages);

      const modelForTurn = toolsForTurn.length > 0
        ? bindTools(toolsForTurn)
        : model;

      let response: AIMessage = await modelForTurn.invoke(promptMessages, runnableConfig);

      if (!(response instanceof AIMessage)) {
        throw new Error("Runtime agent LLM model must return an AI message.");
      }

      // Domain hooks may salvage an empty response (e.g. Obsidian read_file summaries).
      // Only use the recovery retry when the response is still empty afterward.
      if (isEmptyModelResponse(response) && isLoopContinuation) {
        const salvaged = config.processResponse
          ? config.processResponse(ctx, response)
          : response;

        if (!isEmptyModelResponse(salvaged)) {
          response = salvaged;
        } else {
          // Flash-lite and similar models sometimes return empty candidates after tool
          // results. Retry once with an explicit recovery directive so the agent can
          // repair recoverable tool errors or reply with status.
          response = await modelForTurn.invoke(buildRecoveryPromptMessages(promptMessages), runnableConfig);
          if (!(response instanceof AIMessage)) {
            throw new Error("Runtime agent LLM model must return an AI message.");
          }
        }
      }

      const processed = config.processResponse
        ? config.processResponse(ctx, response)
        : sanitizeResponseToolCalls(response, ctx.allowedToolNames);

      const responseText = extractMessageTextContent(processed.content).trim();
      const toolCalls = processed.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && responseText.length === 0) {
        // Empty reply — finalize sets lastHandoff for the supervisor to summarize.
        return {
          agentMessages: [new AIMessage({ content: "" })],
          stepCount,
        };
      }

      return { agentMessages: [processed], stepCount };
    } catch (error) {
      return {
        agentMessages: [new AIMessage(buildErrorMessage(error, definition))],
        handoffStatus: "error",
      } as SubAgentStateUpdate;
    }
  };
};

export const createRuntimeAgentFailureMessage = (text: string): AIMessage => new AIMessage(text);
