import { AIMessage } from "@langchain/core/messages";

import {
  createAgentPolicy,
  resolveAgentCapabilityIds,
  type AgentPolicyToolkitOptions,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityCatalog } from "@personal-assistant/supervisor-framework";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";
import type { PersonalResolveTools } from "../composition/personal-resolve-tools.js";
import {
  composeObsidianCapabilityHooks,
  mapObsidianSubAgentResult,
  selectObsidianToolsForTurn,
} from "./obsidian-hooks.js";

export const OBSIDIAN_VAULT_CAPABILITY_ID = "obsidian-vault";

export const hasObsidianVaultCapability = (definition: RuntimeAgentDefinition): boolean =>
  resolveAgentCapabilityIds(definition).includes(OBSIDIAN_VAULT_CAPABILITY_ID);

export type DefaultRuntimePolicyOptions = AgentPolicyToolkitOptions & {
  capabilityCatalog: CapabilityCatalog;
  resolveTools: PersonalResolveTools;
};

/**
 * Default runtime policy: shared shell hooks + app-local capability behaviors
 * (e.g. obsidian-vault vault context and blank-reply recovery).
 */
export const createDefaultRuntimeAgentPolicy = (
  shellHooks: RuntimeAgentNodeHooks,
  options: DefaultRuntimePolicyOptions,
): RuntimeAgentPolicy =>
  createAgentPolicy<CapabilityDeps>({
    executor: "generic",
    resolveTools: (definition, capabilityDeps, resolveOptions) =>
      options.resolveTools(definition, capabilityDeps, resolveOptions ?? {}),
    createHooks: (deps, policyOptions) => {
      if (!hasObsidianVaultCapability(deps.definition)) {
        return shellHooks;
      }

      const vaultRoot = deps.capabilityDeps.obsidianVaultPath;
      if (!vaultRoot) {
        return shellHooks;
      }

      if (!policyOptions.shellFormatters) {
        throw new Error("Obsidian capability hooks require runtime shell formatters.");
      }

      return composeObsidianCapabilityHooks(
        vaultRoot,
        policyOptions.shellFormatters,
        shellHooks,
      );
    },
    selectToolsForTurn: (ctx, tools) =>
      hasObsidianVaultCapability(ctx.definition)
        ? selectObsidianToolsForTurn(ctx, tools)
        : tools,
    resolveMapResult: (definition) =>
      hasObsidianVaultCapability(definition)
        ? (result, { maxSteps }) =>
          mapObsidianSubAgentResult(result, maxSteps, () => ({
            messages: [
              new AIMessage(
                `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
              ),
            ],
          }))
        : undefined,
    logLabel: "generic-runtime-agent",
    buildErrorMessage: (error, definition) =>
      hasObsidianVaultCapability(definition)
        ? `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error during Obsidian request"}`
        : `Unable to run runtime agent ${definition.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
  }, options);

/** @deprecated Use createDefaultRuntimeAgentPolicy */
export const createGenericRuntimeAgentPolicy = createDefaultRuntimeAgentPolicy;
