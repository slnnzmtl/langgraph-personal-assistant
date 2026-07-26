import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { CapabilityCatalog } from "../../capabilities/index.js";
import {
  createAgentPolicy,
  type AgentPolicyToolkitOptions,
} from "../../core/policies/create-agent-policy.js";
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
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { SYSTEM_AGENT_DISPLAY_NAME, SYSTEM_AGENT_ID } from "./definition.js";
import {
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
} from "./system-config-hooks.js";
import type { SystemAgentOptions, SystemConfigDeps } from "./types.js";

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

export type SystemAgentPolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: (
    definition: RuntimeAgentDefinition,
    capabilityDeps: SystemConfigDeps,
    resolveOptions?: Record<string, unknown>,
  ) => StructuredToolInterface[];
  systemAgent: SystemAgentOptions;
};

/** @deprecated Configuration behavior is composed on the default runtime policy (executor: generic). */
export const createSystemAgentPolicy = (options: SystemAgentPolicyOptions) =>
  createAgentPolicy<SystemConfigDeps>({
    executor: SYSTEM_AGENT_ID,
    displayName: SYSTEM_AGENT_DISPLAY_NAME,
    resolveDeps: resolveSystemConfigDeps,
    unavailableMessage: () => SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: () => createSystemAgentNodeHooks(options.shellFormatters!),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
    mapResult: (result, { maxSteps, name }) =>
      mapConfigurationSubAgentResult(result, maxSteps, name),
  }, options);
