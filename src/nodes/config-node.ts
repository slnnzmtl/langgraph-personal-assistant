import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { loadConfiguratorSystemPrompt } from "../prompts/load-system-prompt.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import type { RuntimeSchedulerService } from "../cron/runtime-scheduler-service.js";
import type { CronJobRepository } from "../cron/cron-job-repository.js";
import { formatCronJobForDisplay } from "./config-tools.js";

export const createConfigurationNode = (
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  options?: {
    repository?: CronJobRepository;
    runtimeScheduler?: RuntimeSchedulerService;
  },
) => {
  if (typeof model.bindTools !== "function") {
    throw new Error("Configuration LLM model must support tool calling.");
  }

  const modelWithTools = model.bindTools(tools);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof ToolMessage) {
        const toolContent = typeof lastMessage.content === "string" ? lastMessage.content : String(lastMessage.content);

        // If tool successfully created a cron job and runtime scheduler is available, activate it
        if (
          options?.runtimeScheduler
          && options?.repository
          && toolContent.includes("Created cron job")
        ) {
          try {
            const jobName = toolContent.match(/Created cron job (\S+)/)?.[1];
            if (jobName) {
              const allJobs = await options.repository.loadJobs();
              const newJob = allJobs.find((j) => j.jobName === jobName);
              if (newJob) {
                await options.runtimeScheduler.addJob(newJob);
                const activationMsg = `${toolContent} and activated it for immediate scheduling.\n\n${formatCronJobForDisplay(newJob)}`;
                return { messages: [new AIMessage(activationMsg)] };
              }
            }
          } catch (schedulerError) {
            console.warn("[ConfigNode] Could not activate job in runtime scheduler:", schedulerError instanceof Error ? schedulerError.message : String(schedulerError));
          }
        }

        // If tool successfully deleted a cron job and runtime scheduler is available, remove it
        if (options?.runtimeScheduler && toolContent.includes("Deleted cron job")) {
          try {
            const jobName = toolContent.match(/Deleted cron job (\S+)/)?.[1];
            if (jobName) {
              await options.runtimeScheduler.removeJob(jobName);
            }
          } catch (schedulerError) {
            console.warn("[ConfigNode] Could not remove job from runtime scheduler:", schedulerError instanceof Error ? schedulerError.message : String(schedulerError));
          }
        }

        return { messages: [new AIMessage(toolContent)] };
      }

      const systemInstructions = new SystemMessage(loadConfiguratorSystemPrompt());
      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Configuration LLM model must return an AI message.");
      }

      return { messages: [response] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error during cron configuration";
      return {
        messages: [new AIMessage(`Unable to complete cron configuration: ${errorMessage}`)],
      };
    }
  };
};