import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
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

const stripSchedulerTrigger = (text: string): string => {
  const lines = text.split(/\r?\n/);
  return lines[0]?.startsWith("SYSTEM_CRON_TRIGGER:") ? lines.slice(1).join("\n").trim() : text.trim();
};

const formatDialogMessage = (message: BaseMessage): string | null => {
  const text = extractMessageTextContent(message.content).trim();

  if (message instanceof HumanMessage) {
    const sanitizedText = stripSchedulerTrigger(text);
    return sanitizedText ? `User:\n${sanitizedText}` : null;
  }

  if (message instanceof ToolMessage) {
    const toolName = message.name ?? message.tool_call_id ?? "tool";
    return `Tool result (${toolName}):\n${text}`;
  }

  if (message instanceof AIMessage) {
    return text ? `Assistant:\n${text}` : null;
  }

  return text ? `Message:\n${text}` : null;
};

const buildSummaryDialog = (messages: BaseMessage[]): string =>
  messages.map(formatDialogMessage).filter((message): message is string => Boolean(message)).join("\n\n");

const summarizeJobResult = async (
  model: BaseChatModel,
  job: SchedulerJobRun,
  messages: BaseMessage[],
): Promise<string> => {
  const dialog = buildSummaryDialog(messages);
  const result = await model.invoke([
    new SystemMessage(
      "Write a concise, user-facing summary of the completed scheduled job. " +
      "Use the full dialog to explain what was requested, what tools actually did, and the final outcome. " +
      "Do not mention internal routing, scheduler protocol markers, raw function-call metadata, or that you are summarizing. " +
      "Return plain text only.",
    ),
    new HumanMessage(`Job: ${job.jobName}\n\nCompleted dialog:\n${dialog}`),
  ]);
  const summary = extractMessageTextContent(result.content).trim();

  if (!summary) {
    throw new Error(`Summary model returned an empty response for job: ${job.jobName}`);
  }

  return summary;
};

export const MAX_GRAPH_CONTINUATIONS = 3;

const hasPendingToolCall = (message: BaseMessage | undefined): boolean =>
  message instanceof AIMessage && Boolean(message.tool_calls?.length || (message.additional_kwargs as { functionCall?: unknown } | undefined)?.functionCall);

const isTerminalGraphResult = (messages: BaseMessage[]): boolean => {
  const lastMessage = messages.at(-1);
  return lastMessage instanceof AIMessage && !hasPendingToolCall(lastMessage) && extractMessageTextContent(lastMessage.content).trim().length > 0;
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
        const config = { configurable: { thread_id: createThreadId(job.jobName) } };
        let result = await options.graph.invoke(
          { messages: [buildSchedulerInputMessage(job)] },
          config,
        );
        let resultObject = typeof result === "object" && result !== null ? (result as Partial<SchedulerJobResult>) : {};
        let messages = Array.isArray(resultObject.messages) ? resultObject.messages : [];
        let continuationCount = 0;

        while (!isTerminalGraphResult(messages) && continuationCount < MAX_GRAPH_CONTINUATIONS) {
          if (!hasPendingToolCall(messages.at(-1))) {
            break;
          }
          continuationCount += 1;
          result = await options.graph.invoke({ messages: [] }, config);
          resultObject = typeof result === "object" && result !== null ? (result as Partial<SchedulerJobResult>) : {};
          messages = Array.isArray(resultObject.messages) ? resultObject.messages : [];
        }

        if (!isTerminalGraphResult(messages)) {
          throw new Error(`Scheduled workflow did not reach a terminal result for job: ${job.jobName}`);
        }

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