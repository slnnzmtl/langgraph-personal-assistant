import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import {
  createRuntimeShellHooks,
  extractMessageTextContent,
  sanitizeResponseToolCalls,
  type RuntimeAgentNodeHooks,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { reconcileRuntimeCron } from "../../cron/reconcile-runtime-cron.js";
import { CONFIGURATOR_AGENT_ID, buildSkillModuleOwnerPattern } from "../composition/bootstrap-agents.js";
import { formatCronJobForDisplay } from "../../runtime-agents/policies/configuration/tools.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);
const MUTATING_CRON_TOOLS = new Set(["create_cron_job", "delete_cron_job"]);

const normalizeRequestText = (text: string): string =>
  text.toLowerCase().replaceAll(/\s+/g, " ").trim();

export const isSkillMutatingIntent = (text: string): boolean => {
  const normalized = normalizeRequestText(text);
  return (
    /\b(create|add|new|bootstrap|draft|author|write|edit|update|change|rewrite|delete|remove)\b/.test(normalized)
    && /\bskills?\b/.test(normalized)
  );
};

export const isSkillListDisplayIntent = (text: string): boolean => {
  const normalized = normalizeRequestText(text);
  if (isSkillMutatingIntent(text)) {
    return false;
  }

  return (
    /\b(list|show|view|inspect|what|which|available)\b/.test(normalized)
    && /\bskills?\b/.test(normalized)
  );
};

export const isSkillPreviewDisplayIntent = (text: string): boolean => {
  const normalized = normalizeRequestText(text);
  if (isSkillMutatingIntent(text)) {
    return false;
  }

  return (
    /\b(preview|read|open|show|view|inspect)\b/.test(normalized)
    && /\bskill\b/.test(normalized)
  );
};

const getTriggerUserText = (messages: readonly BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return extractMessageTextContent(message.content).trim();
    }
  }

  return "";
};

export const shouldShortCircuitReadOnlySkillTool = (
  toolName: string,
  triggerUserText: string,
): boolean => {
  if (isSkillMutatingIntent(triggerUserText)) {
    return false;
  }

  if (toolName === "list_skills") {
    return isSkillListDisplayIntent(triggerUserText);
  }

  if (toolName === "preview_skill") {
    return true;
  }

  return false;
};

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
  const baseHooks = createRuntimeShellHooks(options.shellFormatters);

  return {
    ...baseHooks,
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
        const toolName = latestMessage instanceof ToolMessage ? latestMessage.name ?? "" : "";
        const triggerUserText = getTriggerUserText(ctx.state.agentMessages);
        if (shouldShortCircuitReadOnlySkillTool(toolName, triggerUserText)) {
          return { agentMessages: [new AIMessage(readOnlySkillToolResult)] };
        }
      }

      return null;
    },
    processResponse: (ctx, response) => {
      const sanitized = sanitizeResponseToolCalls(response, ctx.allowedToolNames);
      const responseText = extractMessageTextContent(sanitized.content).trim();
      const toolCalls = sanitized.tool_calls ?? [];

      if (toolCalls.length > 0 || responseText.length > 0) {
        return sanitized;
      }

      return new AIMessage("Completed the configuration task.");
    },
  };
};
