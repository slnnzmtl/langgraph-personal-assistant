import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { resolveModel } from "../../core/execution/context.js";
import type { PolicyContext } from "../../core/types/policy-context.js";
import { createSubAgentGraphBundle } from "../../core/execution/create-sub-agent.js";
import { createUnavailableGraphBundle } from "../../core/agents/runtime-agent-graph-bundle.js";
import {
  createRuntimeAgentNode,
  type SubAgentToolSource,
} from "../../core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../core/execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentModelKey } from "../../core/types/agent.js";
import { createRuntimeAgentPolicy } from "../../core/types/policy.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";
import { resolveAgentCapabilityTools } from "../composition/resolve-agent-tools.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import { createFinanceNodeHooks } from "./finance-hooks.js";
import { createObsidianNodeHooks, mapObsidianSubAgentResult } from "./obsidian-hooks.js";

type DomainPolicyOptions = {
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
};

const createDomainLlmNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  hooks: Parameters<typeof createRuntimeAgentNode>[3],
) =>
  createRuntimeAgentNode(model, definition, tools, hooks) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createFinancePolicy = (
  options: DomainPolicyOptions = {},
) =>
  createRuntimeAgentPolicy("finance", (context: PolicyContext, definition) => {
    if (!options.shellFormatters) {
      throw new Error("createFinancePolicy requires runtime shell formatters.");
    }
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
    const session = bundleDeps.supabaseSession;

    if (!session) {
      return createUnavailableGraphBundle("Finance", "Supabase session is not configured.");
    }

    return createSubAgentGraphBundle({
      name: "Finance",
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context, resolveAgentModelKey(definition)),
        definition,
        session,
        bundleDeps,
        skillCatalog: options.skillCatalog,
      },
      createTools: (deps) =>
        resolveAgentCapabilityTools(deps.definition, deps.bundleDeps, {
          ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        }),
      createLlmNode: (deps, tools) =>
        createDomainLlmNode(deps.model, deps.definition, tools, createFinanceNodeHooks(options.shellFormatters!)),
    });
  });

export const createObsidianPolicy = (
  options: DomainPolicyOptions = {},
) =>
  createRuntimeAgentPolicy("obsidian", (context, definition) => {
    if (!options.shellFormatters) {
      throw new Error("createObsidianPolicy requires runtime shell formatters.");
    }
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
    const maxSteps = definition.maxSteps;

    return createSubAgentGraphBundle({
      name: "Obsidian",
      maxSteps,
      deps: {
        model: resolveModel(context, resolveAgentModelKey(definition)),
        vaultRoot: bundleDeps.obsidianVaultPath,
        fileSender: bundleDeps.fileSender,
        definition,
        bundleDeps,
        skillCatalog: options.skillCatalog,
      },
      createTools: (deps) =>
        resolveAgentCapabilityTools(deps.definition, deps.bundleDeps, {
          ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        }),
      createLlmNode: (deps, tools) =>
        createDomainLlmNode(
          deps.model,
          deps.definition,
          tools,
          createObsidianNodeHooks(deps.vaultRoot, options.shellFormatters!),
        ),
      mapResult: (result) =>
        mapObsidianSubAgentResult(result, maxSteps, () => ({
          messages: [
            new AIMessage(
              `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
            ),
          ],
        })),
    });
  });

export const createConfigurationPolicy = (
  options: DomainPolicyOptions = {},
) =>
  createRuntimeAgentPolicy("configuration", (context, definition) => {
    if (!options.shellFormatters) {
      throw new Error("createConfigurationPolicy requires runtime shell formatters.");
    }
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;

    return createSubAgentGraphBundle({
      name: "Configuration",
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context, resolveAgentModelKey(definition)),
        definition,
        bundleDeps,
        repository: context.cronJobRepository,
        runtimeCron: context.runtimeCron,
        skillCatalog: options.skillCatalog,
      },
      createTools: (deps) =>
        resolveAgentCapabilityTools(deps.definition, deps.bundleDeps, {
          ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
        }),
      createLlmNode: (deps, toolSource) =>
        createDomainLlmNode(
          deps.model,
          deps.definition,
          toolSource,
          createConfigurationNodeHooks({
            repository: deps.repository,
            ...(deps.runtimeCron ? { runtimeCron: deps.runtimeCron } : {}),
            ...(deps.skillCatalog ? { skillCatalog: deps.skillCatalog } : {}),
            shellFormatters: options.shellFormatters!,
          }),
        ),
    });
  });
