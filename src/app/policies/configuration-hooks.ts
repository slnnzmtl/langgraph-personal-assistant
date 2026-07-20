import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { sanitizeResponseToolCalls } from "../../core/execution/runtime-node.js";
import { formatSkillsForDisplay, listSkills } from "../../prompts/skills-loader.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { reconcileRuntimeCron } from "../../cron/reconcile-runtime-cron.js";
import { buildBuiltinDomainOwnerPattern } from "../../runtime-agents/builtin-domains.js";
import { formatCronJobForDisplay } from "../../runtime-agents/policies/configuration/tools.js";
import { createSkillAttachmentNodeHooks } from "./skill-scoped-hooks.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);

type ConfigurationHooksOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService | undefined;
};

const isCronJobListRequest = (text: string): boolean => {
  const normalized = text.toLowerCase().replaceAll(/\s+/g, " ").trim();
  return /\b(list|show|view|inspect|what|which)\b/.test(normalized) && /\bcron jobs?\b/.test(normalized);
};

const BUILTIN_DOMAIN_OWNER_PATTERN = buildBuiltinDomainOwnerPattern();

const mentionsSkillOwner = (text: string): boolean =>
  BUILTIN_DOMAIN_OWNER_PATTERN.test(text);

export const isConfigurationSkillCatalogRequest = (text: string): boolean => {
  const normalized = text.toLowerCase().replaceAll(/\s+/g, " ").trim();

  if (mentionsSkillOwner(normalized)) {
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

export const formatConfigurationSkillCatalog = (): string => {
  const skills = listSkills({ module: "configuration" });
  return formatSkillsForDisplay("configuration", skills, "Listed");
};

const getReadOnlySkillToolResult = (latestMessage: ToolMessage | undefined): string | undefined => {
  if (!latestMessage?.name || !READ_ONLY_SKILL_TOOLS.has(latestMessage.name)) {
    return undefined;
  }

  const toolContent = extractMessageTextContent(latestMessage.content).trim();
  return toolContent.length > 0 ? toolContent : undefined;
};

export const createConfigurationNodeHooks = (
  options: ConfigurationHooksOptions,
): RuntimeAgentNodeHooks =>
  createSkillAttachmentNodeHooks({
    logLabel: "configuration-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to update cron configuration: ${error instanceof Error ? error.message : "Unknown error during configuration"}`,
    beforeTurn: async (ctx) => {
      const latestMessage = ctx.state.messages[ctx.state.messages.length - 1];
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

        return { messages: [new AIMessage(content)] };
      }

      if (
        latestMessage instanceof HumanMessage
        && latestMessageText
        && isConfigurationSkillCatalogRequest(latestMessageText)
      ) {
        return { messages: [new AIMessage(formatConfigurationSkillCatalog())] };
      }

      await reconcileRuntimeCron(options.repository, options.runtimeCron);

      const readOnlySkillToolResult = getReadOnlySkillToolResult(
        latestMessage instanceof ToolMessage ? latestMessage : undefined,
      );
      if (readOnlySkillToolResult) {
        return { messages: [new AIMessage(readOnlySkillToolResult)] };
      }

      return null;
    },
  processResponse: (ctx, response) =>
    sanitizeResponseToolCalls(response, ctx.allowedToolNames),
  emptyResponseMessage: () => "Completed the configuration task.",
  });
