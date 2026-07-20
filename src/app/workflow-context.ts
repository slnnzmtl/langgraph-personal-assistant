import { createWorkflowGraph } from "../agent.js";
import type { AppConfig } from "../config.js";
import type { RuntimeCronService } from "../cron/types.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import { createSupervisorSystem, type SupervisorSystemContext } from "./composition/create-supervisor-system.js";

export type WorkflowContext = SupervisorSystemContext;

export type CreateWorkflowContextOptions = {
  runtimeCron?: RuntimeCronService | undefined;
  fileSender?: IFileSender | undefined;
};

export const createWorkflowContext = async (
  config: AppConfig,
  options: CreateWorkflowContextOptions = {},
): Promise<WorkflowContext> =>
  createSupervisorSystem(config, {
    ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
    ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  });

export type { SupabaseMcpSession };
