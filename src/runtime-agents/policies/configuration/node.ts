import { AIMessage, HumanMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { logSystemPromptInvocation } from "../../../logging/system-prompt-logger.js";
import { getSkillsDir } from "../../../prompts/load-system-prompt.js";
import { formatSkillsForDisplay, listSkills } from "../../../prompts/skills-loader.js";
import { extractMessageTextContent } from "../../../nodes/message-history.js";
import { hasPendingToolCalls } from "../../../tools/routing.js";
import type { CronJobDefinition, CronJobRepository, RuntimeCronService } from "../../../cron/types.js";
import {
  isSkillScopedToolContext,
  resolveTurnTools,
  type SubAgentToolSource,
} from "../../execution/create-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../execution/sub-agent-state.js";
import { resolveRuntimeAgentSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentDefinition } from "../../types.js";
import { appendConfiguredSkillAttachments } from "../../skill-attachments.js";
import { formatCronJobForDisplay } from "./tools.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);

type ConfigurationNodeOptions = {
  repository: CronJobRepository;
  runtimeCron?: RuntimeCronService | undefined;
  definition: RuntimeAgentDefinition;
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

const mentionsSkillOwner = (text: string): boolean =>
  /\b(finance|obsidian|configuration)\b/.test(text);

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

const sanitizeResponseToolCalls = (
  response: AIMessage,
  allowedToolNames: Set<string>,
): AIMessage => {
  const toolCalls = response.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return response;
  }

  const validCalls = toolCalls.filter((call) => call.name && allowedToolNames.has(call.name));
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
};

export const createConfigurationNode = (
  model: BaseChatModel,
  tools: SubAgentToolSource,
  options: ConfigurationNodeOptions,
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Configuration LLM model must support tool calling.");
  }

  const bindTools = model.bindTools.bind(model);
  const basePrompt = resolveRuntimeAgentSystemPrompt(options.definition);

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    try {
      const latestMessage = state.messages[state.messages.length - 1];
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

      if (hasPendingToolCalls(state.messages)) {
        return { stepCount: state.stepCount };
      }

      const readOnlySkillToolResult = getReadOnlySkillToolResult(
        latestMessage instanceof ToolMessage ? latestMessage : undefined,
      );
      if (readOnlySkillToolResult) {
        return { messages: [new AIMessage(readOnlySkillToolResult)] };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;

      const toolsForTurn = isSkillScopedToolContext(tools)
        ? resolveTurnTools(tools, state.messages)
        : tools;
      const allowedToolNames = new Set(toolsForTurn.map((tool) => tool.name));

      const systemPrompt = appendConfiguredSkillAttachments(basePrompt, options.definition, state.messages);
      const systemInstructions = new SystemMessage(systemPrompt);
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("configuration-system-prompt", promptMessages);

      const response = await bindTools(toolsForTurn).invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Configuration LLM model must return an AI message.");
      }

      const sanitizedResponse = sanitizeResponseToolCalls(response, allowedToolNames);
      const responseText = extractMessageTextContent(sanitizedResponse.content).trim();
      const toolCalls = sanitizedResponse.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && responseText.length === 0) {
        return { messages: [new AIMessage("Completed the configuration task.")], stepCount };
      }

      return { messages: [sanitizedResponse], stepCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error during configuration";
      return { messages: [new AIMessage(`Unable to update cron configuration: ${message}`)] };
    }
  };
};
