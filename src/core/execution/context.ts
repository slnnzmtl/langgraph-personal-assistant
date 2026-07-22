import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { LoadPromptByKey } from "../agents/resolve-system-prompt.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import type { PromptLoggingHook } from "../ports/prompt-logging.js";
import type { PolicyRegistry } from "../policies/registry.js";
import type { PolicyContext } from "../types/policy-context.js";

export type RuntimeAgentExecutionContext<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
> = PolicyContext<TCapabilityDeps> & {
  loadPromptByKey: LoadPromptByKey;
  policyRegistry: PolicyRegistry;
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
  policyRegistry: PolicyRegistry;
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
  defaultModelKey: input.defaultModelKey ?? "generic",
  repository: input.repository,
  capabilityDeps: input.capabilityDeps,
  loadPromptByKey: input.loadPromptByKey,
  policyRegistry: input.policyRegistry,
  ...(input.promptLogging ? { promptLogging: input.promptLogging } : {}),
});
