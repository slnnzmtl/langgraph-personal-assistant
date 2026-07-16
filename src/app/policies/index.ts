import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { AIMessage } from "@langchain/core/messages";
import { resolveModel } from "../../core/execution/context.js";
import type { PolicyContext } from "../../core/types/policy-context.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import { createSubAgent, createSubAgentOrStub, createMaxStepsExceededUpdate } from "../../core/execution/create-sub-agent.js";
import {
  createRuntimeAgentNode,
  type SubAgentToolSource,
} from "../../core/execution/runtime-node.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../core/execution/sub-agent-state.js";
import type { AgentStateUpdate } from "../../core/state.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import type { RuntimeAgentPolicy } from "../../core/types/policy.js";
import { createFinanceSkillScopedTools } from "../../runtime-agents/policies/finance/tools.js";
import { createObsidianSkillScopedTools } from "../../runtime-agents/policies/obsidian/tools.js";
import { createConfigurationSkillScopedTools } from "../../runtime-agents/policies/configuration/tools.js";
import type { RuntimeToolBundleDeps } from "../../runtime-agents/tool-bundles.js";
import { createConfigurationNodeHooks } from "./configuration-hooks.js";
import { createFinanceNodeHooks } from "./finance-hooks.js";
import { buildObsidianCompletionSummary, createObsidianNodeHooks } from "./obsidian-hooks.js";

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
        createTools: (deps) => createFinanceSkillScopedTools(deps.session!),
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
      createTools: (deps) => createObsidianSkillScopedTools(deps.vaultRoot, deps.fileSender),
      createLlmNode: (deps, tools) =>
        createDomainLlmNode(
          deps.model,
          deps.definition,
          tools,
          createObsidianNodeHooks(deps.vaultRoot),
        ),
      mapResult: (result): AgentStateUpdate => {
        if (result.stepCount >= maxSteps) {
          return createMaxStepsExceededUpdate(
            "Obsidian",
            maxSteps,
            `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
          );
        }

        const lastMessage = result.messages[result.messages.length - 1];
        if (
          lastMessage instanceof AIMessage
          && !(lastMessage.tool_calls?.length)
          && extractMessageTextContent(lastMessage.content).trim().length > 0
        ) {
          return { messages: [lastMessage] };
        }

        return {
          messages: [new AIMessage(buildObsidianCompletionSummary(result.messages))],
        };
      },
    });
  },
});

export const createConfigurationPolicy = (): RuntimeAgentPolicy => ({
  executor: "configuration",
  createHandler: (context, definition) => {
    const bundleDeps = context.bundleDeps as RuntimeToolBundleDeps;
    const configurationTools = createConfigurationSkillScopedTools(
      context.cronJobRepository,
      context.repository,
      bundleDeps,
    );

    return createSubAgent({
      name: "Configuration",
      maxSteps: definition.maxSteps,
      deps: {
        model: resolveModel(context, "configuration"),
        tools: configurationTools,
        definition,
        repository: context.cronJobRepository,
        runtimeCron: context.runtimeCron,
      },
      createTools: (deps) => deps.tools,
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
