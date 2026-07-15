import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { CronJobDefinition, CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { loadConfigurationSystemPrompt } from "../../prompts/load-system-prompt.js";
import { extractMessageTextContent } from "../message-history.js";
import { hasPendingToolCalls } from "../../tools/routing.js";
import type { AgentState, AgentStateUpdate } from "../../state.js";
import { formatCronJobForDisplay } from "./config-tools.js";

const READ_ONLY_SKILL_TOOLS = new Set(["preview_skill", "list_skills"]);

type ConfigurationNodeOptions = {
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

const getReadOnlySkillToolResult = (latestMessage: ToolMessage | undefined): string | undefined => {
  if (!latestMessage?.name || !READ_ONLY_SKILL_TOOLS.has(latestMessage.name)) {
    return undefined;
  }

  const toolContent = extractMessageTextContent(latestMessage.content).trim();
  return toolContent.length > 0 ? toolContent : undefined;
};

export const createConfigurationNode = (
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  options: ConfigurationNodeOptions,
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Configuration LLM model must support tool calling.");
  }

  const modelWithTools = model.bindTools(tools);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      const latestMessage = state.messages[state.messages.length - 1];
      const latestMessageText = latestMessage ? extractMessageTextContent(latestMessage.content).trim() : "";

      if (latestMessageText && isCronJobListRequest(latestMessageText)) {
        const jobs = await options.repository.loadJobs();
        const content = jobs.length > 0
          ? jobs.map(formatCronJobForDisplay).join("\n\n")
          : "No cron jobs configured.";

        return { messages: [new AIMessage(content)] };
      }

      await reconcileRuntimeCron(options.repository, options.runtimeCron);

      if (hasPendingToolCalls(state.messages)) {
        return {};
      }

      const readOnlySkillToolResult = getReadOnlySkillToolResult(
        latestMessage instanceof ToolMessage ? latestMessage : undefined,
      );
      if (readOnlySkillToolResult) {
        return { messages: [new AIMessage(readOnlySkillToolResult)] };
      }

      const systemInstructions = new SystemMessage(loadConfigurationSystemPrompt());
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      await logSystemPromptInvocation("configurator-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Configuration LLM model must return an AI message.");
      }

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && responseText.length === 0) {
        return { messages: [new AIMessage("Completed the configuration task.")] };
      }

      return { messages: [response] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error during configuration";
      return { messages: [new AIMessage(`Unable to update cron configuration: ${message}`)] };
    }
  };
};
