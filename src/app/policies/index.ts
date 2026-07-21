import { AIMessage } from "@langchain/core/messages";

import type { PolicyContext } from "../../core/types/policy-context.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import { createObsidianNodeHooks, mapObsidianSubAgentResult } from "./obsidian-hooks.js";
import {
  createDomainGraphPolicy,
  type DomainPolicyOptions,
} from "./create-domain-graph-policy.js";

export const createObsidianPolicy = (options: DomainPolicyOptions = {}) =>
  createDomainGraphPolicy({
    executor: "obsidian",
    displayName: "Obsidian",
    resolveDeps: (context: PolicyContext) => {
      const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
      return {
        vaultRoot: bundleDeps.obsidianVaultPath,
        fileSender: bundleDeps.fileSender,
      };
    },
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
  createDomainGraphPolicy({
    executor: "configuration",
    displayName: "Configuration",
    resolveDeps: (context: PolicyContext, _definition: RuntimeAgentDefinition) => ({
      repository: context.cronJobRepository,
      runtimeCron: context.runtimeCron,
    }),
    createHooks: (deps, policyOptions) =>
      createConfigurationNodeHooks({
        repository: deps.repository,
        ...(deps.runtimeCron ? { runtimeCron: deps.runtimeCron } : {}),
        ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        shellFormatters: policyOptions.shellFormatters!,
      }),
  }, options);
