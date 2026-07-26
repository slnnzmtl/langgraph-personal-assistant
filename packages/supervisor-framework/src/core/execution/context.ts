import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { LoadPromptByKey } from "../agents/resolve-system-prompt.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import type { PromptLoggingHook } from "../ports/prompt-logging.js";
import type { PolicyContext } from "../types/policy-context.js";
import type { RuntimeAgentPolicy } from "../types/policy.js";
import { DEFAULT_PRODUCT_EXECUTOR } from "../types/agent.js";

export type RuntimeAgentExecutionContext<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
> = PolicyContext<TCapabilityDeps> & {
  loadPromptByKey: LoadPromptByKey;
  runtimeAgentPolicy: RuntimeAgentPolicy;
  promptLogging?: PromptLoggingHook;
};

export type CreateRuntimeAgentExecutionContextInput<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  models: Record<string, BaseChatModel>;
  defaultModelKey?: string;
  repository: RuntimeAgentRepository;
  capabilityDeps: TCapabilityDeps;
  loadPromptByKey: LoadPromptByKey;
  runtimeAgentPolicy: RuntimeAgentPolicy;
  promptLogging?: PromptLoggingHook;
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
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
>(
  input: CreateRuntimeAgentExecutionContextInput<TCapabilityDeps>,
): RuntimeAgentExecutionContext<TCapabilityDeps> => ({
  models: input.models,
  defaultModelKey: input.defaultModelKey ?? DEFAULT_PRODUCT_EXECUTOR,
  repository: input.repository,
  capabilityDeps: input.capabilityDeps,
  loadPromptByKey: input.loadPromptByKey,
  runtimeAgentPolicy: input.runtimeAgentPolicy,
  ...(input.promptLogging ? { promptLogging: input.promptLogging } : {}),
});
