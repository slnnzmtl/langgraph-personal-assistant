import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { RuntimeAgentRepository } from "../agents/repository.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";

export type PolicyContext<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  models: Record<string, BaseChatModel>;
  defaultModelKey: string;
  repository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps: TBundleDeps;
};
