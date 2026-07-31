import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { extractMessageTextContent } from "../../core/message-content.js";
import type { CronRunLedger } from "./cron-run-ledger.js";
import type {
  CronExecutionReporter,
  CronJobResult,
  CronJobRun,
} from "./types.js";

export type { CronExecutionReporter, CronJobResult, CronJobRun } from "./types.js";

export type CronRunner = {
  run(job: CronJobRun): Promise<void>;
};

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

type CronRunnerOptions = {
  getGraph: () => GraphInvoker;
  summaryModel: BaseChatModel;
  onError(error: unknown, context: CronJobRun): void;
  reporter?: CronExecutionReporter;
  ledger?: CronRunLedger;
};

const createThreadId = (jobName: string): string => `cron:${jobName}:${randomUUID()}`;

const buildCronInputMessage = (job: CronJobRun): HumanMessage => {
  if (job.payload === undefined || job.payload === null) {
    return new HumanMessage(job.trigger);
  }

  const payloadText = typeof job.payload === "string" ? job.payload : JSON.stringify(job.payload, null, 2);

  return new HumanMessage(`${job.trigger}\n\nPayload:\n${payloadText}`);
};

const stripCronTrigger = (text: string): string => {
  const lines = text.split(/\r?\n/);
  return lines[0]?.startsWith("SYSTEM_CRON_TRIGGER:") ? lines.slice(1).join("\n").trim() : text.trim();
};

const formatDialogMessage = (message: BaseMessage): string | null => {
  const text = extractMessageTextContent(message.content).trim();

  if (message instanceof HumanMessage) {
    const sanitizedText = stripCronTrigger(text);
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
  job: CronJobRun,
  messages: BaseMessage[],
): Promise<string> => {
  const dialog = buildSummaryDialog(messages);
  const result = await model.invoke([
    new SystemMessage(
      "Write a concise, user-facing summary of the completed scheduled job. " +
      "Use the full dialog to explain what was requested, what tools actually did, and the final outcome. " +
      "Do not mention internal routing, cron protocol markers, raw function-call metadata, or that you are summarizing. " +
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

export const createCronRunner = (options: CronRunnerOptions): CronRunner => {
  const inFlightJobs = new Set<string>();

  const report = async (callback: (() => Promise<void> | void) | undefined): Promise<void> => {
    if (!callback) {
      return;
    }

    try {
      await callback();
    } catch (error) {
      console.warn("[Cron] Reporter callback failed:", error);
    }
  };

  return {
    async run(job: CronJobRun): Promise<void> {
      const activeRun = options.ledger?.tryBeginRun(job) ?? null;
      if (options.ledger && !activeRun) {
        console.warn(`[Cron] Skipping overlapping run for job: ${job.jobName} (ledger)`);
        return;
      }

      if (!options.ledger && inFlightJobs.has(job.jobName)) {
        console.warn(`[Cron] Skipping overlapping run for job: ${job.jobName}`);
        return;
      }

      if (!options.ledger) {
        inFlightJobs.add(job.jobName);
      }

      console.log(`[Cron] Running job: ${job.jobName} with trigger: ${job.trigger}`);
      if (options.reporter?.onStart) {
        await report(() => options.reporter?.onStart?.(job));
      }

      if (options.reporter?.onProgress) {
        await report(() => options.reporter?.onProgress?.(job, "Dispatching scheduled workflow."));
      }

      try {
        const config = { configurable: { thread_id: createThreadId(job.jobName) } };
        let result = await options.getGraph().invoke(
          { messages: [buildCronInputMessage(job)] },
          config,
        );
        let resultObject = typeof result === "object" && result !== null ? (result as Partial<CronJobResult>) : {};
        let messages = Array.isArray(resultObject.messages) ? resultObject.messages : [];
        let continuationCount = 0;

        while (!isTerminalGraphResult(messages) && continuationCount < MAX_GRAPH_CONTINUATIONS) {
          if (!hasPendingToolCall(messages.at(-1))) {
            break;
          }
          continuationCount += 1;
          result = await options.getGraph().invoke({ messages: [] }, config);
          resultObject = typeof result === "object" && result !== null ? (result as Partial<CronJobResult>) : {};
          messages = Array.isArray(resultObject.messages) ? resultObject.messages : [];
        }

        if (!isTerminalGraphResult(messages)) {
          throw new Error(`Scheduled workflow did not reach a terminal result for job: ${job.jobName}`);
        }

        const summary = await summarizeJobResult(options.summaryModel, job, messages);
        if (activeRun) {
          options.ledger?.completeRun(activeRun.runId, { status: "succeeded" });
        }
        await report(() => options.reporter?.onSuccess?.({ ...job, ...resultObject, summary }));
      } catch (error) {
        if (activeRun) {
          options.ledger?.completeRun(activeRun.runId, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
        options.onError(error, job);
        await report(() => options.reporter?.onError?.(error, job));
      } finally {
        if (!options.ledger) {
          inFlightJobs.delete(job.jobName);
        }
      }
    },
  };
};
