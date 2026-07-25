import { AIMessage } from "@langchain/core/messages";

import {
  createAgentPolicy,
  type AgentPolicyToolkitOptions,
  type CapabilityCatalog,
  type RuntimeAgentExecutionContext,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";
import type { PersonalResolveTools } from "../composition/personal-resolve-tools.js";
import {
  createObsidianNodeHooks,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "./obsidian-hooks.js";

export type DomainPolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
};

export const createObsidianPolicy = (options: DomainPolicyOptions) =>
  createAgentPolicy<CapabilityDeps, { vaultRoot: string; fileSender?: CapabilityDeps["fileSender"] }>({
    executor: "obsidian",
    displayName: "Obsidian",
    resolveDeps: (context: RuntimeAgentExecutionContext<CapabilityDeps>) => ({
      vaultRoot: context.capabilityDeps.obsidianVaultPath,
      fileSender: context.capabilityDeps.fileSender,
    }),
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
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
