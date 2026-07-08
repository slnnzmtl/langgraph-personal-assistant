import { HumanMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";

export type SchedulerJobRun = {
  jobName: string;
  trigger: string;
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

export const createSchedulerRunner = (options: SchedulerRunnerOptions): SchedulerRunner => {
  const inFlightJobs = new Set<string>();

  return {
    async run(job: SchedulerJobRun): Promise<void> {
      if (inFlightJobs.has(job.jobName)) {
        console.warn(`[Scheduler] Skipping overlapping run for job: ${job.jobName}`);
        return;
      }

      inFlightJobs.add(job.jobName);

      try {
        await options.graph.invoke(
          { messages: [new HumanMessage(job.trigger)] },
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