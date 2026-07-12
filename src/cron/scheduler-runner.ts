import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { extractMessageTextContent } from "../nodes/message-history.js";

export type SchedulerJobRun = {
  jobName: string;
  trigger: string;
  // payload may be a string or structured JSON object
  payload?: unknown;
};

export type SchedulerJobResult = SchedulerJobRun & {
  messages?: BaseMessage[];
  summary?: string;
};

export type SchedulerRunner = {
  run(job: SchedulerJobRun): Promise<void>;
};

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

type SchedulerRunnerOptions = {
  graph: GraphInvoker;
  summaryModel: BaseChatModel;
  onError(error: unknown, context: SchedulerJobRun): void;
  reporter?: SchedulerExecutionReporter;
};

export type SchedulerExecutionReporter = {
  onStart?(job: SchedulerJobRun): Promise<void> | void;
  onProgress?(job: SchedulerJobRun, message: string): Promise<void> | void;
  onSuccess?(job: SchedulerJobResult): Promise<void> | void;
  onError?(error: unknown, context: SchedulerJobRun): Promise<void> | void;
};

const createThreadId = (jobName: string): string => `scheduler:${jobName}:${randomUUID()}`;

const buildSchedulerInputMessage = (job: SchedulerJobRun): HumanMessage => {
  if (job.payload === undefined || job.payload === null) {
    return new HumanMessage(job.trigger);
  }

  // If payload is a string, embed it as-is. Otherwise stringify JSON with indentation so consumers can parse it.
  const payloadText = typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload, null, 2);

  return new HumanMessage(`${job.trigger}\n\nPayload:\n${payloadText}`);
};

const summarizeJobResult = async (
  model: BaseChatModel,
  job: SchedulerJobRun,
  messages: BaseMessage[],
): Promise<string> => {
  const result = await model.invoke([
    new SystemMessage(
      "Write a concise, user-facing summary of the completed scheduled job. " +
      "State what was done and any important result or issue. Do not mention internal routing, " +
      "cron triggers, tool calls, or that you are summarizing. Return plain text only.",
    ),
    new HumanMessage(
      `Job: ${job.jobName}\n\nCompleted workflow messages:\n${
        messages.map((message) => extractMessageTextContent(message.content).trim()).filter(Boolean).join("\n\n")
      }`,
    ),
  ]);
  const summary = extractMessageTextContent(result.content).trim();

  if (!summary) {
    throw new Error(`Summary model returned an empty response for job: ${job.jobName}`);
  }

  return summary;
};

export const createSchedulerRunner = (options: SchedulerRunnerOptions): SchedulerRunner => {
  const inFlightJobs = new Set<string>();

  const report = async (callback: (() => Promise<void> | void) | undefined): Promise<void> => {
    if (!callback) {
      return;
    }

    try {
      await callback();
    } catch (error) {
      console.warn("[Scheduler] Reporter callback failed:", error);
    }
  };

  return {
    async run(job: SchedulerJobRun): Promise<void> {
      if (inFlightJobs.has(job.jobName)) {
        console.warn(`[Scheduler] Skipping overlapping run for job: ${job.jobName}`);
        return;
      }

      inFlightJobs.add(job.jobName);

      console.log(`[Scheduler] Running job: ${job.jobName} with trigger: ${job.trigger}`);
      if (options.reporter?.onStart) {
        await report(() => options.reporter?.onStart?.(job));
      }

      if (options.reporter?.onProgress) {
        await report(() => options.reporter?.onProgress?.(job, "Dispatching scheduled workflow."));
      }

      try {
        const result = await options.graph.invoke(
          { messages: [buildSchedulerInputMessage(job)] },
          { configurable: { thread_id: createThreadId(job.jobName) } },
        );

        const resultObject = typeof result === "object" && result !== null ? (result as Partial<SchedulerJobResult>) : {};
        const messages = Array.isArray(resultObject.messages) ? resultObject.messages : [];
        const summary = await summarizeJobResult(options.summaryModel, job, messages);
        await report(() => options.reporter?.onSuccess?.({ ...job, ...resultObject, summary }));
      } catch (error) {
        options.onError(error, job);
        await report(() => options.reporter?.onError?.(error, job));
      } finally {
        inFlightJobs.delete(job.jobName);
      }
    },
  };
};