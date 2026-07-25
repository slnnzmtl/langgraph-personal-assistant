import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { configurationReposAvailable } from "../../capabilities/index.js";
import type { CapabilityCatalog } from "../../capabilities/index.js";
import {
  createAgentPolicy,
  type AgentPolicyToolkitOptions,
} from "../../core/policies/create-agent-policy.js";
import {
  sanitizeResponseToolCalls,
  type RuntimeAgentNodeHooks,
} from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import { extractMessageTextContent } from "../../core/messages/message-content.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeAgentExecutionContext } from "../../core/execution/context.js";
import { SYSTEM_AGENT_DISPLAY_NAME, SYSTEM_AGENT_ID } from "./definition.js";
import type { SystemAgentOptions, SystemConfigDeps } from "./types.js";

export const createSystemAgentNodeHooks = (
  shellFormatters: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  const baseHooks = createRuntimeShellHooks(shellFormatters);

  return {
    ...baseHooks,
    processResponse: (ctx, response) => {
      const sanitized = sanitizeResponseToolCalls(response, ctx.allowedToolNames);
      const responseText = extractMessageTextContent(sanitized.content).trim();
      const toolCalls = sanitized.tool_calls ?? [];

      if (toolCalls.length > 0 || responseText.length > 0) {
        return sanitized;
      }

      return new AIMessage("Completed the configuration task.");
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

export const createSystemAgentPolicy = (options: SystemAgentPolicyOptions) =>
  createAgentPolicy<SystemConfigDeps>({
    executor: SYSTEM_AGENT_ID,
    displayName: SYSTEM_AGENT_DISPLAY_NAME,
    resolveDeps: (context: RuntimeAgentExecutionContext<SystemConfigDeps>) =>
      configurationReposAvailable(context.capabilityDeps) ? {} : null,
    unavailableMessage: () =>
      "Configuration is unavailable because cron and runtime agent storage are not configured.",
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: () => createSystemAgentNodeHooks(options.shellFormatters!),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  }, options);
