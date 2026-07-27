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

export const mapConfigurationSubAgentResult = (
  result: SubAgentState,
  maxSteps: number,
  name: string,
): AgentStateUpdate => {
  const lastMessage = result.agentMessages[result.agentMessages.length - 1];

  if (hasCompletedAgentReply(lastMessage, CONFIGURATION_COMPLETION_FALLBACK)) {
    return { messages: [lastMessage] };
  }

  const summary = buildConfigurationCompletionSummary(result.agentMessages);
  if (summary) {
    return { messages: [new AIMessage(summary)] };
  }

  if (result.stepCount >= maxSteps) {
    return createMaxStepsExceededUpdate(name, maxSteps);
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
        buildSummary: buildConfigurationCompletionSummary,
      });
    },
  };
};
