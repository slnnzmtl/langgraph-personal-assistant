import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { resolveModel } from "../../core/execution/context.js";
import type { PolicyContext } from "../../core/types/policy-context.js";
import { createSubAgent, createSubAgentOrStub } from "../../core/execution/create-sub-agent.js";
import {
  createRuntimeAgentNode,
  type SubAgentToolSource,
} from "../../core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../core/execution/sub-agent-state.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeAgentPolicy } from "../../core/types/policy.js";
import { createFinanceTools } from "../../runtime-agents/policies/finance/tools.js";
import { createObsidianTools } from "../../runtime-agents/policies/obsidian/tools.js";
import { createReadSkillTool } from "../../tools/skill-management.js";
import { resolveRuntimeToolBundles } from "../../runtime-agents/tool-bundles.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import { createFinanceNodeHooks } from "./finance-hooks.js";
import { createObsidianNodeHooks, mapObsidianSubAgentResult } from "./obsidian-hooks.js";

const createDomainLlmNode = (
  model: BaseChatModel,
  definition: RuntimeAgentDefinition,
  tools: SubAgentToolSource | undefined,
  hooks: Parameters<typeof createRuntimeAgentNode>[3],
) =>
  createRuntimeAgentNode(model, definition, tools, hooks) as (
    state: SubAgentState,
  ) => Promise<SubAgentStateUpdate>;

export const createFinancePolicy = (): RuntimeAgentPolicy => ({
  executor: "finance",
  createHandler: (context: PolicyContext, definition) => {
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
    const session = bundleDeps.supabaseSession;

    return createSubAgentOrStub(
      (deps) => deps.session !== undefined,
      "Supabase session is not configured.",
      {
        name: "Finance",
        maxSteps: definition.maxSteps,
        deps: {
          model: resolveModel(context, "finance"),
          definition,
          session,
        },
        createTools: (deps) => createFinanceTools(deps.session!),
        createLlmNode: (deps, tools) =>
          createDomainLlmNode(deps.model, deps.definition, tools, createFinanceNodeHooks()),
      },
    );
  },
});

export const createObsidianPolicy = (): RuntimeAgentPolicy => ({
  executor: "obsidian",
  createHandler: (context, definition) => {
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
    const maxSteps = definition.maxSteps;

    return createSubAgent({
      name: "Obsidian",
      maxSteps,
      deps: {
        model: resolveModel(context, "obsidian"),
        vaultRoot: bundleDeps.obsidianVaultPath,
        fileSender: bundleDeps.fileSender,
        definition,
      },
      createTools: (deps) => createObsidianTools(deps.vaultRoot, deps.fileSender),
      createLlmNode: (deps, tools) =>
        createDomainLlmNode(
          deps.model,
          deps.definition,
          tools,
          createObsidianNodeHooks(deps.vaultRoot),
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
  },
});

export const createConfigurationPolicy = (): RuntimeAgentPolicy => ({
  executor: "configuration",
  createHandler: (context, definition) => {
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;

    return createSubAgent({
      name: "Configuration",
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context, "configuration"),
        definition,
        bundleDeps,
        repository: context.cronJobRepository,
        runtimeCron: context.runtimeCron,
      },
      createTools: (deps) => [
        createReadSkillTool("configuration", "xml"),
        ...resolveRuntimeToolBundles(deps.definition.toolBundleIds, deps.bundleDeps),
      ],
      createLlmNode: (deps, toolSource) =>
        createDomainLlmNode(
          deps.model,
          deps.definition,
          toolSource,
          createConfigurationNodeHooks({
            repository: deps.repository,
            runtimeCron: deps.runtimeCron,
          }),
        ),
    });
  },
});
