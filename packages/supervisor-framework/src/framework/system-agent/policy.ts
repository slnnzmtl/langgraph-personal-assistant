import { AIMessage, type BaseMessage } from "@langchain/core/messages";

import {
  createMaxStepsExceededUpdate,
} from "../../core/execution/create-sub-agent.js";
import type { SubAgentState } from "../../core/execution/sub-agent-state.js";
import {
  sanitizeResponseToolCalls,
  type RuntimeAgentNodeHooks,
} from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import { extractMessageTextContent } from "../../core/message-content.js";
import {
  buildLatestToolCompletionSummary,
  defaultConsumableToolBody,
  hasCompletedAgentReply,
  processBlankToolLoopResponse,
} from "../../core/execution/tool-completion-summary.js";
import type { AgentStateUpdate } from "../../core/state.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";

export const CONFIGURATION_COMPLETION_FALLBACK = "Completed the configuration task.";

export const buildConfigurationCompletionSummary = (
  messages: BaseMessage[],
): string | undefined =>
  buildLatestToolCompletionSummary(messages, defaultConsumableToolBody);

export const buildConfigurationErrorSummary = (
  messages: BaseMessage[],
): string | undefined =>
  buildLatestToolCompletionSummary(messages, (content) => content.trim().startsWith("Error:"));

export const buildConfigurationSalvageSummary = (
  messages: BaseMessage[],
): string | undefined =>
  buildConfigurationCompletionSummary(messages) ?? buildConfigurationErrorSummary(messages);

const isConfigurationCompletionFallback = (message: BaseMessage | undefined): message is AIMessage =>
  message instanceof AIMessage
  && !(message.tool_calls?.length)
  && extractMessageTextContent(message.content).trim() === CONFIGURATION_COMPLETION_FALLBACK;

export const mapConfigurationSubAgentResult = (
  result: SubAgentState,
  maxSteps: number,
  name: string,
): AgentStateUpdate => {
  const lastMessage = result.agentMessages[result.agentMessages.length - 1];

  if (hasCompletedAgentReply(lastMessage, CONFIGURATION_COMPLETION_FALLBACK)) {
    return { messages: [lastMessage] };
  }

  const summary = buildConfigurationSalvageSummary(result.agentMessages);
  if (summary) {
    return { messages: [new AIMessage(summary)] };
  }

  if (result.stepCount >= maxSteps) {
    return createMaxStepsExceededUpdate(name, maxSteps);
  }

  if (isConfigurationCompletionFallback(lastMessage)) {
    return { messages: [lastMessage] };
  }

  return { messages: [new AIMessage({ content: "" })] };
};

export const createSystemAgentNodeHooks = (
  shellFormatters: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  const baseHooks = createRuntimeShellHooks(shellFormatters);

  return {
    ...baseHooks,
    processResponse: (ctx, response) => {
      const sanitized = sanitizeResponseToolCalls(response, ctx.allowedToolNames);
      return processBlankToolLoopResponse(ctx, sanitized, {
        completionFallback: CONFIGURATION_COMPLETION_FALLBACK,
        buildSummary: buildConfigurationSalvageSummary,
      });
    },
  };
};
