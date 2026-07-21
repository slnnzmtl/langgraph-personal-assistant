import { AIMessage } from "@langchain/core/messages";

import { createAgentPolicy, type AgentPolicyToolkitOptions } from "../../core/policies/create-agent-policy.js";
import type { PolicyContext } from "../../core/types/policy-context.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import { createObsidianNodeHooks, mapObsidianSubAgentResult } from "./obsidian-hooks.js";
import { resolveAgentCapabilityTools } from "../composition/resolve-agent-tools.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";

export type DomainPolicyOptions = AgentPolicyToolkitOptions;

const resolveCapabilityTools = (
  definition: RuntimeAgentDefinition,
  bundleDeps: Record<string, unknown>,
  options: { skillCatalog?: SkillCatalog },
) => resolveAgentCapabilityTools(definition, bundleDeps as RuntimeToolBundleDeps, options);

export const createObsidianPolicy = (options: DomainPolicyOptions = {}) =>
  createAgentPolicy({
    executor: "obsidian",
    displayName: "Obsidian",
    resolveDeps: (context: PolicyContext) => {
      const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
      return {
        vaultRoot: bundleDeps.obsidianVaultPath,
        fileSender: bundleDeps.fileSender,
      };
    },
    resolveTools: resolveCapabilityTools,
    createHooks: (deps, policyOptions) =>
      createObsidianNodeHooks(deps.vaultRoot, policyOptions.shellFormatters!),
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
  createAgentPolicy({
    executor: "configuration",
    displayName: "Configuration",
    resolveDeps: (context: PolicyContext, _definition: RuntimeAgentDefinition) => ({
      repository: context.cronJobRepository,
      runtimeCron: context.runtimeCron,
    }),
    resolveTools: resolveCapabilityTools,
    createHooks: (deps, policyOptions) =>
      createConfigurationNodeHooks({
        repository: deps.repository,
        ...(deps.runtimeCron ? { runtimeCron: deps.runtimeCron } : {}),
        ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        shellFormatters: policyOptions.shellFormatters!,
      }),
  }, options);
