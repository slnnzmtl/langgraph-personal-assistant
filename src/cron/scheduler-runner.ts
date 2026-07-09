import { HumanMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

export type SchedulerJobRun = {
  jobName: string;
  trigger: string;
  payload?: string;
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
};

const createThreadId = (jobName: string): string => `scheduler:${jobName}:${randomUUID()}`;

const buildSchedulerInputMessage = (job: SchedulerJobRun): HumanMessage => {
  if (!job.payload) {
    return new HumanMessage(job.trigger);
  }

  return new HumanMessage(`${job.trigger}\n\nPayload:\n${job.payload}`);
};

export const createSchedulerRunner = (options: SchedulerRunnerOptions): SchedulerRunner => {
  const inFlightJobs = new Set<string>();

  return {
    async run(job: SchedulerJobRun): Promise<void> {
      if (inFlightJobs.has(job.jobName)) {
        console.warn(`[Scheduler] Skipping overlapping run for job: ${job.jobName}`);
        return;
      }

      inFlightJobs.add(job.jobName);

      console.log(`[Scheduler] Running job: ${job.jobName} with trigger: ${job.trigger}`);

      try {
        await options.graph.invoke(
          { messages: [buildSchedulerInputMessage(job)] },
          { configurable: { thread_id: createThreadId(job.jobName) } },
        );
      } catch (error) {
        options.onError(error, job);
      } finally {
        inFlightJobs.delete(job.jobName);
      }
    },
  };
};