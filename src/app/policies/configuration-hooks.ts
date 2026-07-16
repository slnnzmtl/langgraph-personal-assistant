import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { isSkillScopedToolContext, resolveTurnTools } from "../../core/execution/create-sub-agent.js";
import { getSkillsDir } from "../../prompts/load-system-prompt.js";
import { formatSkillsForDisplay, listSkills } from "../../prompts/skills-loader.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import type { CronJobDefinition, CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { appendConfiguredSkillAttachments } from "../../runtime-agents/skill-attachments.js";
import { buildBuiltinDomainOwnerPattern } from "../../runtime-agents/builtin-domains.js";
import { formatCronJobForDisplay } from "../../runtime-agents/policies/configuration/tools.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);

type ConfigurationHooksOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService | undefined;
};

const reconcileRuntimeCron = async (
  repository: CronJobRepository,
  runtimeCron?: RuntimeCronService,
): Promise<void> => {
  if (!runtimeCron) {
    return;
  }

  const persistedJobs = await repository.loadJobs();
  const persistedJobsByName = new Map(persistedJobs.map((job) => [job.jobName, job]));
  const activeJobsByName = new Map(runtimeCron.listActiveJobs().map((job: CronJobDefinition) => [job.jobName, job]));

  for (const [jobName] of activeJobsByName) {
    if (!persistedJobsByName.has(jobName as string)) {
      await runtimeCron.removeJob(jobName);
    }
  }

  for (const [jobName, job] of persistedJobsByName) {
    if (!activeJobsByName.has(jobName)) {
      await runtimeCron.addJob(job as CronJobDefinition);
    }
  }
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
  const skillsDir = getSkillsDir("configuration", "xml");
  const skills = listSkills(skillsDir);
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
): RuntimeAgentNodeHooks => ({
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
  buildSystemPrompt: (ctx) =>
    appendConfiguredSkillAttachments(ctx.basePrompt, ctx.definition, ctx.state.messages),
  resolveToolsForTurn: (ctx) => {
    if (!ctx.tools) {
      return [];
    }

    return isSkillScopedToolContext(ctx.tools)
      ? resolveTurnTools(ctx.tools, ctx.state.messages)
      : ctx.tools;
  },
  processResponse: (ctx, response) => {
    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return response;
    }

    const validCalls = toolCalls.filter((call) => call.name && ctx.allowedToolNames.has(call.name));
    if (validCalls.length === toolCalls.length) {
      return response;
    }

    if (validCalls.length > 0) {
      return new AIMessage({
        content: response.content,
        tool_calls: validCalls,
      });
    }

    const responseText = extractMessageTextContent(response.content).trim();
    return new AIMessage(
      responseText.length > 0
        ? responseText
        : "That tool is not available yet. Call read_skill with the matching configuration skill name first.",
    );
  },
  emptyResponseMessage: () => "Completed the configuration task.",
});
