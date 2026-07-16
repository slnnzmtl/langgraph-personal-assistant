import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { PromptResolver } from "../agents/prompt-resolver.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import type { PolicyRegistry } from "../policies/registry.js";

let nextExecutionContextId = 0;

export type RuntimeAgentExecutionContext<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  instanceId: number;
  models: Record<string, BaseChatModel>;
  defaultModelKey: string;
  repository: RuntimeAgentRepository;
  cronJobRepository: import("../../cron/types.js").CronJobRepository;
  runtimeCron?: import("../../cron/types.js").RuntimeCronService;
  bundleDeps: TBundleDeps;
  promptResolver: PromptResolver;
  policyRegistry: PolicyRegistry;
};

export type CreateRuntimeAgentExecutionContextInput<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  repository: RuntimeAgentRepository;
  cronJobRepository: import("../../cron/types.js").CronJobRepository;
  runtimeCron?: import("../../cron/types.js").RuntimeCronService;
  bundleDeps?: TBundleDeps;
  promptResolver: PromptResolver;
  policyRegistry: PolicyRegistry;
};

export const resolveModel = (
  context: RuntimeAgentExecutionContext,
  key?: string,
): BaseChatModel => {
  const modelKey = key ?? context.defaultModelKey;
  const model = context.models[modelKey];

  if (!model) {
    throw new Error(`No model registered for key: ${modelKey}`);
  }

  return model;
};

export const createRuntimeAgentExecutionContext = <
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
>(
  input: CreateRuntimeAgentExecutionContextInput<TBundleDeps>,
): RuntimeAgentExecutionContext<TBundleDeps> => ({
  instanceId: ++nextExecutionContextId,
  models: input.models,
  defaultModelKey: input.defaultModelKey ?? "generic",
  repository: input.repository,
  cronJobRepository: input.cronJobRepository,
  ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
  bundleDeps: (input.bundleDeps ?? {}) as TBundleDeps,
  promptResolver: input.promptResolver,
  policyRegistry: input.policyRegistry,
});
