import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

import { extractMessageTextContent } from "../../core/message-content.js";
import type { CronRunLedger } from "./cron-run-ledger.js";
import type {
  CronExecutionReporter,
  CronJobResult,
  CronJobRun,
} from "./types.js";

export type CronRunner = {
  run(job: CronJobRun): Promise<void>;
};

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

type CronRunnerOptions = {
  getGraph: () => GraphInvoker;
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

const extractTerminalSummary = (messages: BaseMessage[], jobName: string): string => {
  const lastMessage = messages.at(-1);
  const summary = lastMessage instanceof AIMessage
    ? extractMessageTextContent(lastMessage.content).trim()
    : "";

  if (!summary) {
    throw new Error(`Scheduled workflow returned an empty terminal message for job: ${jobName}`);
  }

  return summary;
};

const MAX_GRAPH_CONTINUATIONS = 3;

const hasPendingToolCall = (message: BaseMessage | undefined): boolean =>
  message instanceof AIMessage && Boolean(message.tool_calls?.length);

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

        const summary = extractTerminalSummary(messages, job.jobName);
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
