import type { StructuredToolInterface } from "@langchain/core/tools";

import type { CapabilityCatalog } from "../../../capabilities/index.js";
import {
  createAgentPolicy,
  type AgentPolicyToolkitOptions,
} from "../../../core/policies/create-agent-policy.js";
import type { RuntimeAgentDefinition } from "../../../core/types/agent.js";
import type { SkillCatalog } from "../../../core/skills/catalog.js";
import type { CronJobRepository } from "../../types.js";
import type { RuntimeAgentExecutionContext } from "../../../core/execution/context.js";
import { SYSTEM_AGENT_ID } from "../constants.js";
import type { SystemAgentOptions, SystemConfigDeps } from "../types.js";
import { createSystemAgentNodeHooks } from "./hooks.js";

export type SystemAgentPolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: (
    definition: RuntimeAgentDefinition,
    capabilityDeps: SystemConfigDeps,
    resolveOptions?: Record<string, unknown>,
  ) => StructuredToolInterface[];
  systemAgent: SystemAgentOptions;
  skillCatalog?: SkillCatalog;
};

export const createSystemAgentPolicy = (options: SystemAgentPolicyOptions) =>
  createAgentPolicy<
    SystemConfigDeps,
    { repository: CronJobRepository; onCronMutated?: () => Promise<void> }
  >({
    executor: SYSTEM_AGENT_ID,
    displayName: "Configuration",
    resolveDeps: (context: RuntimeAgentExecutionContext<SystemConfigDeps>) => {
      const { cronJobRepository } = context.capabilityDeps;

      if (!cronJobRepository) {
        return null;
      }

      return {
        repository: cronJobRepository,
        ...(options.systemAgent.onCronMutated
          ? { onCronMutated: options.systemAgent.onCronMutated }
          : {}),
      };
    },
    unavailableMessage: () => "Configuration is unavailable because cron job storage is not configured.",
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) =>
      createSystemAgentNodeHooks({
        repository: deps.repository,
        ...(deps.onCronMutated ? { onCronMutated: deps.onCronMutated } : {}),
        ...(policyOptions.skillCatalog ? { skillCatalog: policyOptions.skillCatalog } : {}),
        shellFormatters: policyOptions.shellFormatters!,
      }),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  }, options);
