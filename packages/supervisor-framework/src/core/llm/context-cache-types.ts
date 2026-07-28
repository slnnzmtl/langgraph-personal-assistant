import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { RuntimeAgentDefinition } from "../types/agent.js";

export type ContextCacheSpec = {
  modelName: string;
  staticSystemInstruction: string;
  tools: StructuredToolInterface[];
  displayName: string;
  ttlSeconds?: number;
};

export type ContextCacheHandle = {
  cacheName: string;
  /** Gemini model resource name, e.g. models/gemini-2.5-flash (required by useCachedContent). */
  model: string;
};

export type ContextCacheManager = {
  getOrCreate(spec: ContextCacheSpec): Promise<ContextCacheHandle | null>;
};

export type CreateCachedModel = (
  apiKey: string,
  modelName: string,
  handle: Pick<ContextCacheHandle, "cacheName" | "model">,
) => BaseChatModel;

/** Shared cache wiring for supervisor routing and runtime agent turns. */
export type ContextCacheKit = {
  cacheManager: ContextCacheManager;
  apiKey: string;
  createCachedModel: CreateCachedModel;
  resolveRuntimeModelName: (definition: RuntimeAgentDefinition) => string;
  supervisorModelName: string;
};
