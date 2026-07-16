import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { AIMessage } from "@langchain/core/messages";
import { resolveModel, type RuntimeAgentExecutionContext } from "../../core/execution/context.js";
import { createSubAgent, createSubAgentOrStub } from "../../core/execution/create-sub-agent.js";
import type { AgentStateUpdate } from "../../core/state.js";
import type { RuntimeAgentPolicy } from "../../core/types/policy.js";
import { FINANCE_MAX_STEPS, OBSIDIAN_MAX_STEPS, CONFIGURATION_MAX_STEPS } from "../../runtime-agents/constants.js";
import { createFinanceSkillScopedTools } from "../../runtime-agents/policies/finance/tools.js";
import { createObsidianSkillScopedTools } from "../../runtime-agents/policies/obsidian/tools.js";
import { createConfigurationSkillScopedTools } from "../../runtime-agents/policies/configuration/tools.js";
import {
  createConfigurationLlmNode,
  createFinanceLlmNode,
  createObsidianLlmNode,
} from "./factories.js";

export type AppBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
};

export const createFinancePolicy = (): RuntimeAgentPolicy => ({
  executor: "finance",
  createHandler: (context: RuntimeAgentExecutionContext, definition) => {
    const resolvedDefinition = context.promptResolver.withResolvedSystemPrompt(definition);
    const session = context.bundleDeps.supabaseSession as SupabaseMcpSession | undefined;

    return createSubAgentOrStub(
      (deps) => deps.session !== undefined,
      "Supabase session is not configured.",
      {
        name: "Finance",
        maxSteps: resolvedDefinition.maxSteps ?? FINANCE_MAX_STEPS,
        deps: {
          model: resolveModel(context, "finance"),
          definition: resolvedDefinition,
          session,
        },
        createTools: (deps) => createFinanceSkillScopedTools(deps.session!),
        createLlmNode: (deps, tools) =>
          createFinanceLlmNode(context.promptResolver, deps.model, deps.definition, tools),
      },
    );
  },
});

export const createObsidianPolicy = (): RuntimeAgentPolicy => ({
  executor: "obsidian",
  createHandler: (context, definition) => {
    const resolvedDefinition = context.promptResolver.withResolvedSystemPrompt(definition);
    const maxSteps = resolvedDefinition.maxSteps ?? OBSIDIAN_MAX_STEPS;
    const vaultRoot = context.bundleDeps.obsidianVaultPath as string;
    const fileSender = context.bundleDeps.fileSender as IFileSender | undefined;

    return createSubAgent({
      name: "Obsidian",
      maxSteps,
      deps: {
        model: resolveModel(context, "obsidian"),
        vaultRoot,
        fileSender,
        definition: resolvedDefinition,
      },
      createTools: (deps) => createObsidianSkillScopedTools(deps.vaultRoot, deps.fileSender),
      createLlmNode: (deps, tools) =>
        createObsidianLlmNode(
          context.promptResolver,
          deps.model,
          deps.vaultRoot,
          deps.definition,
          tools,
        ),
      mapResult: (result): AgentStateUpdate => {
        if (result.stepCount >= maxSteps) {
          return {
            messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`)],
          };
        }

        const lastMessage = result.messages[result.messages.length - 1];
        return {
          messages: [lastMessage as AIMessage],
        };
      },
    });
  },
});

export const createConfigurationPolicy = (): RuntimeAgentPolicy => ({
  executor: "configuration",
  createHandler: (context, definition) => {
    const resolvedDefinition = context.promptResolver.withResolvedSystemPrompt(definition);
    const configurationTools = createConfigurationSkillScopedTools(
      context.cronJobRepository,
      context.repository,
      context.bundleDeps as AppBundleDeps,
    );

    return createSubAgent({
      name: "Configuration",
      maxSteps: resolvedDefinition.maxSteps ?? CONFIGURATION_MAX_STEPS,
      deps: {
        model: resolveModel(context, "configuration"),
        tools: configurationTools,
        definition: resolvedDefinition,
      },
      createTools: (deps) => deps.tools,
      createLlmNode: (deps, toolSource) =>
        createConfigurationLlmNode(
          context.promptResolver,
          deps.model,
          toolSource,
          {
            repository: context.cronJobRepository,
            runtimeCron: context.runtimeCron,
            definition: deps.definition,
          },
        ),
    });
  },
});
