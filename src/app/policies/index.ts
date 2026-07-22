import { AIMessage } from "@langchain/core/messages";

import { createAgentPolicy, type AgentPolicyToolkitOptions } from "../../core/policies/create-agent-policy.js";
import type { RuntimeAgentExecutionContext } from "../../core/execution/context.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import {
  createObsidianNodeHooks,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "./obsidian-hooks.js";
import { resolveAgentCapabilityTools } from "../composition/resolve-agent-tools.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";

export type DomainPolicyOptions = AgentPolicyToolkitOptions;

const resolveCapabilityTools = (
  definition: RuntimeAgentDefinition,
  bundleDeps: RuntimeToolBundleDeps,
  options: { skillCatalog?: SkillCatalog },
) => resolveAgentCapabilityTools(definition, bundleDeps, options);

export const createObsidianPolicy = (options: DomainPolicyOptions = {}) =>
  createAgentPolicy<RuntimeToolBundleDeps, { vaultRoot: string; fileSender?: RuntimeToolBundleDeps["fileSender"] }>({
    executor: "obsidian",
    displayName: "Obsidian",
    resolveDeps: (context: RuntimeAgentExecutionContext<RuntimeToolBundleDeps>) => ({
      vaultRoot: context.bundleDeps.obsidianVaultPath,
      fileSender: context.bundleDeps.fileSender,
    }),
    resolveTools: resolveCapabilityTools,
    createHooks: (deps, policyOptions) =>
      createObsidianNodeHooks(deps.vaultRoot, policyOptions.shellFormatters!),
    logLabel: "obsidian-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`,
    selectToolsForTurn: selectObsidianToolsForTurn,
    mapResult: (result, { maxSteps }) =>
      mapObsidianSubAgentResult(result, maxSteps, () => ({
        messages: [
          new AIMessage(
            `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
          ),
        ],
      })),
  }, options);

export const createConfigurationPolicy = (options: DomainPolicyOptions = {}) =>
  createAgentPolicy<
    RuntimeToolBundleDeps,
    { repository: NonNullable<RuntimeToolBundleDeps["cronJobRepository"]>; runtimeCron?: RuntimeToolBundleDeps["runtimeCron"] }
  >({
    executor: "configuration",
    displayName: "Configuration",
    resolveDeps: (context: RuntimeAgentExecutionContext<RuntimeToolBundleDeps>) => {
      const { cronJobRepository, runtimeCron } = context.bundleDeps;

      if (!cronJobRepository) {
        return null;
      }

      return { repository: cronJobRepository, runtimeCron };
    },
    unavailableMessage: () => "Configuration is unavailable because cron job storage is not configured.",
    resolveTools: resolveCapabilityTools,
    createHooks: (deps, policyOptions) =>
      createConfigurationNodeHooks({
        repository: deps.repository,
        ...(deps.runtimeCron ? { runtimeCron: deps.runtimeCron } : {}),
        ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        shellFormatters: policyOptions.shellFormatters!,
      }),
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
  }, options);
