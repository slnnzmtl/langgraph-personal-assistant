import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

export type SchedulerJobRun = {
  jobName: string;
  trigger: string;
  // payload may be a string or structured JSON object
  payload?: unknown;
};

export type SchedulerJobResult = SchedulerJobRun & {
  messages?: BaseMessage[];
};

export type SchedulerRunner = {
  run(job: SchedulerJobRun): Promise<void>;
};

type GraphInvoker = {
  invoke(input: unknown, config?: unknown): Promise<unknown>;
};

type SchedulerRunnerOptions = {
  graph: GraphInvoker;
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
        await report(() => options.reporter?.onSuccess?.({ ...job, ...resultObject }));
      } catch (error) {
        options.onError(error, job);
        await report(() => options.reporter?.onError?.(error, job));
      } finally {
        inFlightJobs.delete(job.jobName);
      }
    },
  };
};