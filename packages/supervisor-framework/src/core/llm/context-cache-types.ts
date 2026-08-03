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
  /** Drop a cached handle so the next getOrCreate recreates it (e.g. after Gemini TTL 403). */
  invalidate(cacheName: string): void;
};

/** True when Gemini rejected a stale / missing explicit CachedContent name. */
export const isCachedContentNotFoundError = (error: unknown): boolean => {
  const text = error instanceof Error
    ? [error.message, error.cause instanceof Error ? error.cause.message : String(error.cause ?? "")]
      .join("\n")
    : String(error);
  const mentionsMissingCache = /CachedContent not found/i.test(text)
    || /Cached content not found/i.test(text);

  if (mentionsMissingCache) {
    return true;
  }

  const status = error && typeof error === "object" && "status" in error
    ? (error as { status: unknown }).status
    : undefined;
  return (status === 403 || status === "403") && /cached\s*content/i.test(text);
};

export type CreateCachedModel = (
  apiKey: string,
  modelName: string,
  handle: Pick<ContextCacheHandle, "cacheName" | "model">,
  temperature?: number,
) => BaseChatModel;

/** Shared cache wiring for supervisor routing and runtime agent turns. */
export type ContextCacheKit = {
  cacheManager: ContextCacheManager;
  apiKey: string;
  createCachedModel: CreateCachedModel;
  resolveRuntimeModelName: (definition: RuntimeAgentDefinition) => string;
  supervisorModelName: string;
};
