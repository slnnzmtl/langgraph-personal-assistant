import type { BaseMessage } from "@langchain/core/messages";

import type { MapSubAgentResultOptions } from "../../core/execution/map-sub-agent-result.js";
import {
  sanitizeResponseToolCalls,
  type RuntimeAgentNodeHooks,
} from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import {
  buildLatestToolCompletionSummary,
  defaultConsumableToolBody,
  processBlankToolLoopResponse,
} from "../../core/execution/tool-completion-summary.js";
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

/** Finalize options for system-config agents — consumed by createAgentPolicy via hooks.resultMapping. */
export const CONFIGURATION_RESULT_MAPPING: MapSubAgentResultOptions = {
  completionFallback: CONFIGURATION_COMPLETION_FALLBACK,
  buildSummary: buildConfigurationSalvageSummary,
  emptyHandoffWhenNoSalvage: true,
};

export const createSystemAgentNodeHooks = (
  shellFormatters: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  const baseHooks = createRuntimeShellHooks(shellFormatters);

  return {
    ...baseHooks,
    resultMapping: CONFIGURATION_RESULT_MAPPING,
    processResponse: (ctx, response) => {
      const sanitized = sanitizeResponseToolCalls(response, ctx.allowedToolNames);
      return processBlankToolLoopResponse(ctx, sanitized, {
        completionFallback: CONFIGURATION_COMPLETION_FALLBACK,
        buildSummary: buildConfigurationSalvageSummary,
      });
    },
  };
};
