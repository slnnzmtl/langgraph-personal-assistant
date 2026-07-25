import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import {
  sanitizeResponseToolCalls,
  type RuntimeAgentNodeHooks,
} from "../../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../../core/execution/runtime-shell.js";
import { extractMessageTextContent } from "../../../core/messages/message-content.js";
import type { RuntimeShellFormatters } from "../../../core/system-context.js";
import type { SkillCatalog } from "../../../core/skills/catalog.js";
import type { CronJobRepository } from "../../types.js";
import { SYSTEM_AGENT_ID } from "../constants.js";
import { formatCronJobForDisplay } from "../tools/cron-tools.js";
import type { SystemCronJob } from "../types.js";

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

const getTriggerUserText = (messages: readonly BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return extractMessageTextContent(message.content).trim();
    }
  }

  return "";
};

const isCronJobListRequest = (text: string): boolean => {
  const normalized = text.toLowerCase().replaceAll(/\s+/g, " ").trim();
  return /\b(list|show|view|inspect|what|which)\b/.test(normalized) && /\bcron jobs?\b/.test(normalized);
};

export const buildSkillModuleOwnerPattern = (modules: readonly string[]): RegExp => {
  const owners = modules.map((owner) => owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (owners.length === 0) {
    return /(?!)/;
  }

  return new RegExp(`\\b(${owners.join("|")})\\b`);
};

const mentionsSkillOwner = (text: string, modules: readonly string[]): boolean =>
  buildSkillModuleOwnerPattern(modules).test(text);

export const isSystemAgentSkillCatalogRequest = (
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

export const formatSystemAgentSkillCatalog = (skillCatalog: SkillCatalog): string => {
  const skills = skillCatalog.listSkills({ module: SYSTEM_AGENT_ID });
  return skillCatalog.formatForDisplay(SYSTEM_AGENT_ID, skills, "Listed");
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

export type SystemAgentHooksOptions = {
  repository: CronJobRepository;
  onCronMutated?: () => Promise<void>;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters: RuntimeShellFormatters;
};

export const createSystemAgentNodeHooks = (
  options: SystemAgentHooksOptions,
): RuntimeAgentNodeHooks => {
  const skillModules = options.skillCatalog?.listModules() ?? [SYSTEM_AGENT_ID];
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
        const jobs = (await options.repository.loadJobs()) as SystemCronJob[];
        const content = jobs.length > 0
          ? jobs.map(formatCronJobForDisplay).join("\n\n")
          : "No cron jobs configured.";

        return { agentMessages: [new AIMessage(content)] };
      }

      if (
        latestMessage instanceof HumanMessage
        && latestMessageText
        && options.skillCatalog
        && isSystemAgentSkillCatalogRequest(latestMessageText, skillModules)
      ) {
        return { agentMessages: [new AIMessage(formatSystemAgentSkillCatalog(options.skillCatalog))] };
      }

      if (shouldReconcileCron(ctx.state.agentMessages) && options.onCronMutated) {
        await options.onCronMutated();
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
