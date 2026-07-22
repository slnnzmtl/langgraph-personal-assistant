import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { RuntimeAgentRepository } from "../agents/repository.js";

export type PolicyContext<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
> = {
  models: Record<string, BaseChatModel>;
  defaultModelKey: string;
  repository: RuntimeAgentRepository;
  capabilityDeps: TCapabilityDeps;
};
