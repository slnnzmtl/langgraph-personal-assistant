import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AppBundleDeps, AppRuntimeAgentExecutionContext } from "../../src/app/bundle-deps.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/runtime-agent-catalog.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import {
  createRuntimeAgentExecutionContext as createCoreExecutionContext,
  resolveModel,
} from "../../src/core/execution/context.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/defaults.js";
import { createRuntimeAgentRepositoryFake } from "./fakes.js";

export type { AppBundleDeps, AppRuntimeAgentExecutionContext };

export type CreateAppRuntimeExecutionContextInput = {
  defaultModel: BaseChatModel;
  repository?: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps: AppBundleDeps;
  executors?: Iterable<string>;
};

export const createAppRuntimeExecutionContext = (
  input: CreateAppRuntimeExecutionContextInput,
): AppRuntimeAgentExecutionContext => {
  const runtimeAgents = buildDefaultRuntimeAgents();
  const defaultModelKey = "generic";
  const executors = input.executors ?? deriveExecutors(runtimeAgents);
  const { promptResolver, policyRegistry } = createAppExecutionKit(executors);
  const cronTargetAgentIds = input.bundleDeps.cronTargetAgentIds
    ?? deriveCronTargetAgentIds(runtimeAgents);

  return createCoreExecutionContext<AppBundleDeps>({
    models: Object.fromEntries(
      [...deriveModelKeys(runtimeAgents, defaultModelKey)].map((modelKey) => [
        modelKey,
        input.defaultModel,
      ]),
    ),
    defaultModelKey,
    repository: input.repository ?? createRuntimeAgentRepositoryFake(),
    cronJobRepository: input.cronJobRepository,
    ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
    bundleDeps: {
      ...input.bundleDeps,
      cronTargetAgentIds,
    },
    promptResolver,
    policyRegistry,
  });
};

export { resolveModel };
