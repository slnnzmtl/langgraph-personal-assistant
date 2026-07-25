import { AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

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

const MUTATING_CRON_TOOLS = new Set(["create_cron_job", "delete_cron_job"]);

const shouldReconcileCron = (messages: readonly { name?: string }[]): boolean =>
  messages.some((message) => message.name && MUTATING_CRON_TOOLS.has(message.name));

type SystemAgentHooksOptions = {
  onCronMutated?: () => Promise<void>;
  shellFormatters: RuntimeShellFormatters;
};

export const createSystemAgentNodeHooks = (
  options: SystemAgentHooksOptions,
): RuntimeAgentNodeHooks => {
  const baseHooks = createRuntimeShellHooks(options.shellFormatters);

  return {
    ...baseHooks,
    beforeTurn: async (ctx) => {
      if (shouldReconcileCron(ctx.state.agentMessages) && options.onCronMutated) {
        await options.onCronMutated();
      }

      return null;
    },
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
  createAgentPolicy<
    SystemConfigDeps,
    { onCronMutated?: () => Promise<void> }
  >({
    executor: SYSTEM_AGENT_ID,
    displayName: SYSTEM_AGENT_DISPLAY_NAME,
    resolveDeps: (context: RuntimeAgentExecutionContext<SystemConfigDeps>) => {
      if (!context.capabilityDeps.cronJobRepository) {
        return null;
      }

      return options.systemAgent.onCronMutated
        ? { onCronMutated: options.systemAgent.onCronMutated }
        : {};
    },
    unavailableMessage: () => "Configuration is unavailable because cron job storage is not configured.",
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: () =>
      createSystemAgentNodeHooks({
        ...(options.systemAgent.onCronMutated
          ? { onCronMutated: options.systemAgent.onCronMutated }
          : {}),
        shellFormatters: options.shellFormatters!,
      }),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  }, options);
