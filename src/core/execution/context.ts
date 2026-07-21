import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { LoadPromptByKey } from "../agents/resolve-system-prompt.js";
import type { PolicyRegistry } from "../policies/registry.js";
import type { PolicyContext } from "../types/policy-context.js";

export type RuntimeAgentExecutionContext<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = PolicyContext<TBundleDeps> & {
  loadPromptByKey: LoadPromptByKey;
  policyRegistry: PolicyRegistry;
};

export type CreateRuntimeAgentExecutionContextInput<
  TBundleDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  repository: PolicyContext<TBundleDeps>["repository"];
  cronJobRepository: PolicyContext<TBundleDeps>["cronJobRepository"];
  runtimeCron?: PolicyContext<TBundleDeps>["runtimeCron"];
  bundleDeps?: TBundleDeps;
  loadPromptByKey: LoadPromptByKey;
  policyRegistry: PolicyRegistry;
};

export const resolveModel = (
  context: Pick<PolicyContext, "models" | "defaultModelKey">,
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
  models: input.models,
  defaultModelKey: input.defaultModelKey ?? "generic",
  repository: input.repository,
  cronJobRepository: input.cronJobRepository,
  ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
  bundleDeps: (input.bundleDeps ?? {}) as TBundleDeps,
  loadPromptByKey: input.loadPromptByKey,
  policyRegistry: input.policyRegistry,
});
