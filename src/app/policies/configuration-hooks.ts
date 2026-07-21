import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { sanitizeResponseToolCalls } from "../../core/execution/runtime-node.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { reconcileRuntimeCron } from "../../cron/reconcile-runtime-cron.js";
import { CONFIGURATOR_AGENT_ID, buildSkillModuleOwnerPattern } from "../composition/bootstrap-agents.js";
import { formatCronJobForDisplay } from "../../runtime-agents/policies/configuration/tools.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);
const MUTATING_CRON_TOOLS = new Set(["create_cron_job", "delete_cron_job"]);

type ConfigurationHooksOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters: RuntimeShellFormatters;
};

const isCronJobListRequest = (text: string): boolean => {
  const normalized = text.toLowerCase().replaceAll(/\s+/g, " ").trim();
  return /\b(list|show|view|inspect|what|which)\b/.test(normalized) && /\bcron jobs?\b/.test(normalized);
};

const mentionsSkillOwner = (text: string, modules: readonly string[]): boolean =>
  buildSkillModuleOwnerPattern(modules).test(text);

export const isConfigurationSkillCatalogRequest = (
  text: string,
  modules: readonly string[],
): boolean => {
  const normalized = text.toLowerCase().replaceAll(/\s+/g, " ").trim();

  if (mentionsSkillOwner(normalized, modules)) {
    return false;
  }

  if (/\bcron jobs?\b/.test(normalized)) {
    return false;
  }

  return (
    /\b(list|show|view|what|which|available)\b/.test(normalized)
    && /\b(skills?|capabilities)\b/.test(normalized)
  );
};

export const formatConfigurationSkillCatalog = (skillCatalog: SkillCatalog): string => {
  const skills = skillCatalog.listSkills({ module: CONFIGURATOR_AGENT_ID });
  return skillCatalog.formatForDisplay(CONFIGURATOR_AGENT_ID, skills, "Listed");
};

const getReadOnlySkillToolResult = (latestMessage: ToolMessage | undefined): string | undefined => {
  if (!latestMessage?.name || !READ_ONLY_SKILL_TOOLS.has(latestMessage.name)) {
    return undefined;
  }

  const toolContent = extractMessageTextContent(latestMessage.content).trim();
  return toolContent.length > 0 ? toolContent : undefined;
};

const shouldReconcileCron = (messages: readonly { name?: string }[]): boolean =>
  messages.some((message) => message.name && MUTATING_CRON_TOOLS.has(message.name));

export const createConfigurationNodeHooks = (
  options: ConfigurationHooksOptions,
): RuntimeAgentNodeHooks => {
  const skillModules = options.skillCatalog?.listModules() ?? [CONFIGURATOR_AGENT_ID];

  return createRuntimeShellHooks(options.shellFormatters, {
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
    beforeTurn: async (ctx) => {
      const latestMessage = ctx.state.agentMessages[ctx.state.agentMessages.length - 1];
      const latestMessageText = latestMessage ? extractMessageTextContent(latestMessage.content).trim() : "";

      if (
        latestMessage instanceof HumanMessage
        && latestMessageText
        && isCronJobListRequest(latestMessageText)
      ) {
        const jobs = await options.repository.loadJobs();
        const content = jobs.length > 0
          ? jobs.map(formatCronJobForDisplay).join("\n\n")
          : "No cron jobs configured.";

        return { agentMessages: [new AIMessage(content)] };
      }

      if (
        latestMessage instanceof HumanMessage
        && latestMessageText
        && options.skillCatalog
        && isConfigurationSkillCatalogRequest(latestMessageText, skillModules)
      ) {
        return { agentMessages: [new AIMessage(formatConfigurationSkillCatalog(options.skillCatalog))] };
      }

      if (shouldReconcileCron(ctx.state.agentMessages)) {
        await reconcileRuntimeCron(options.repository, options.runtimeCron);
      }

      const readOnlySkillToolResult = getReadOnlySkillToolResult(
        latestMessage instanceof ToolMessage ? latestMessage : undefined,
      );
      if (readOnlySkillToolResult) {
        return { agentMessages: [new AIMessage(readOnlySkillToolResult)] };
      }

      return null;
    },
    processResponse: (ctx, response) =>
      sanitizeResponseToolCalls(response, ctx.allowedToolNames),
    emptyResponseMessage: () => "Completed the configuration task.",
  });
};
