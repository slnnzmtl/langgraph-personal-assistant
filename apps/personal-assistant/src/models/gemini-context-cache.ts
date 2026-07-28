import { createHash } from "node:crypto";

import type { StructuredToolInterface } from "@langchain/core/tools";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { isInteropZodSchema } from "@langchain/core/utils/types";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  GoogleAICacheManager,
  SchemaType,
  type CachedContent,
  type Content,
  type FunctionDeclaration,
  type Tool,
} from "@google/generative-ai/server";

import type {
  ContextCacheHandle,
  ContextCacheManager,
  ContextCacheSpec,
} from "@personal-assistant/supervisor-framework";
import { getLogger } from "@personal-assistant/supervisor-framework";

const DEFAULT_TTL_SECONDS = 3600;

const normalizeModelName = (modelName: string): string =>
  modelName.startsWith("models/") ? modelName : `models/${modelName}`;

// Most-specific families first so e.g. gemini-3-flash matches 4096, not flash's 2048.
const CACHE_MIN_TOKEN_RULES: ReadonlyArray<{ match: RegExp; minTokens: number }> = [
  { match: /gemini-3/i, minTokens: 4096 },
  { match: /flash-lite/i, minTokens: 1024 },
  { match: /flash/i, minTokens: 2048 },
];
// Same as the flash minimum — safest generic default for unknown gemini/* models.
const DEFAULT_CACHE_MIN_TOKENS = 2048;
const MIN_TOKEN_ESTIMATE_SAFETY_TOKENS = 64;
const TOKEN_ESTIMATE_SAFETY_FRACTION = 0.05;

export const resolveCacheMinTokens = (modelName: string): number => {
  const bareModelName = modelName.replace(/^models\//, "");
  const rule = CACHE_MIN_TOKEN_RULES.find(({ match }) => match.test(bareModelName));
  return rule?.minTokens ?? DEFAULT_CACHE_MIN_TOKENS;
};

const estimateTokenCount = (text: string): number => Math.ceil(text.length / 4);

const computeSafetyMarginTokens = (fixedEstimate: number): number =>
  Math.max(
    MIN_TOKEN_ESTIMATE_SAFETY_TOKENS,
    Math.ceil(fixedEstimate * TOKEN_ESTIMATE_SAFETY_FRACTION),
  );

// Prompt text only — ignored="true" is not a Gemini API directive.
// The bootstrap/ack pair stays in cached context but is worded to be ignored.
const CACHE_SEED_PREAMBLE =
  '<cache_bootstrap ignored="true">Internal size bootstrap only. No user intent; ignore completely.\n';
const CACHE_SEED_EPILOGUE = "\n</cache_bootstrap>";
const CACHE_SEED_ACK =
  "Acknowledged cache bootstrap. Awaiting real user turns; ignore the bootstrap block.";

/**
 * Builds the immutable cache seed `contents` as a closed user/model turn pair.
 * Only the seed is padded to the model's minimum cache size — `staticSystemInstruction`
 * stays byte-identical to the uncached prompt so cache-hit and cache-miss behavior match.
 */
export const buildCacheSeedContents = (
  spec: ContextCacheSpec,
  functionDeclarationsJson: string,
  extraDeficitTokens = 0,
): Content[] => {
  const minTokens = resolveCacheMinTokens(spec.modelName);
  const fixedEstimate =
    estimateTokenCount(spec.staticSystemInstruction) +
    estimateTokenCount(functionDeclarationsJson) +
    estimateTokenCount(CACHE_SEED_PREAMBLE) +
    estimateTokenCount(CACHE_SEED_EPILOGUE) +
    estimateTokenCount(CACHE_SEED_ACK);

  // extraDeficitTokens (used on retry, sourced from Gemini's reported shortfall) must
  // add on top of the clamped estimate-based deficit, not inside the clamp — otherwise
  // an inflated initial estimate (common for dense XML prompts, where chars/4 overshoots
  // the real tokenizer) makes the inner sum negative and silently swallows the retry's
  // padding, causing every retry to fail identically forever.
  // extraDeficitTokens (used on retry, sourced from Gemini's reported shortfall) must
  // add on top of the clamped estimate-based deficit, not inside the clamp — otherwise
  // an inflated initial estimate (common for dense XML prompts, where chars/4 overshoots
  // the real tokenizer) makes the inner sum negative and silently swallows the retry's
  // padding, causing every retry to fail identically forever.
  const estimateDeficitTokens = Math.max(
    0,
    minTokens - fixedEstimate + computeSafetyMarginTokens(fixedEstimate),
  );
  const deficitTokens = estimateDeficitTokens + extraDeficitTokens;
  // Repeated "pad " approximates chars/4; highly repetitive text may tokenize tighter.
  const padding = deficitTokens > 0 ? "pad ".repeat(deficitTokens) : "";

  return [
    {
      role: "user",
      parts: [{ text: `${CACHE_SEED_PREAMBLE}${padding}${CACHE_SEED_EPILOGUE}` }],
    },
    {
      role: "model",
      parts: [{ text: CACHE_SEED_ACK }],
    },
  ];
};

const collectErrorText = (error: unknown): string => {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
    if (error.cause !== undefined) {
      parts.push(collectErrorText(error.cause));
    }
  } else {
    parts.push(String(error));
  }

  if (error && typeof error === "object" && "errorDetails" in error) {
    parts.push(JSON.stringify((error as { errorDetails: unknown }).errorDetails));
  }

  return parts.join("\n");
};

/** Parses Gemini's "Cached content is too small" 400 to compute the exact shortfall. */
export const parseCacheTooSmallShortfall = (error: unknown): number | null => {
  const text = collectErrorText(error);
  const minMatch = text.match(/min_total_token_count=(\d+)/i);
  const totalMatch = text.match(/(?:^|[^a-z_])total_token_count=(\d+)/i);
  if (!totalMatch || !minMatch) {
    return null;
  }

  const totalTokenCount = Number(totalMatch[1]);
  const minTotalTokenCount = Number(minMatch[1]);
  return Math.max(0, minTotalTokenCount - totalTokenCount);
};

const toGeminiFunctionDeclarations = (
  tools: StructuredToolInterface[],
): FunctionDeclaration[] =>
  tools.map((tool) => {
    const jsonSchema = isInteropZodSchema(tool.schema)
      ? toJsonSchema(tool.schema)
      : (tool.schema as Record<string, unknown>);
    const { properties, required } = jsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: properties ?? {},
        ...(required?.length ? { required } : {}),
      },
    } as FunctionDeclaration;
  });

const computeFunctionDeclarationsJson = (tools: StructuredToolInterface[]): string =>
  toGeminiFunctionDeclarations(tools)
    .map((declaration) => JSON.stringify(declaration))
    .sort()
    .join("|");

export const fingerprintContextCacheSpec = (spec: ContextCacheSpec): string => {
  const declarations = computeFunctionDeclarationsJson(spec.tools);

  return createHash("sha256")
    .update(`${spec.modelName}\0${spec.staticSystemInstruction}\0${declarations}`)
    .digest("hex");
};

const toCacheHandle = (
  cached: CachedContent,
  fallbackModelName: string,
): ContextCacheHandle | null => {
  if (!cached.name) {
    return null;
  }

  return {
    cacheName: cached.name,
    model: cached.model ?? normalizeModelName(fallbackModelName),
  };
};

export const createGeminiContextCacheManager = (
  apiKey: string,
  enabled = true,
): ContextCacheManager => {
  const caches = new Map<string, CachedContent>();
  const pendingCreates = new Map<string, Promise<ContextCacheHandle | null>>();

  const createCache = async (
    spec: ContextCacheSpec,
    fingerprint: string,
  ): Promise<ContextCacheHandle | null> => {
    if (!enabled) {
      return null;
    }

    const existing = caches.get(fingerprint);
    if (existing?.name) {
      return toCacheHandle(existing, spec.modelName);
    }

    const cacheManager = new GoogleAICacheManager(apiKey);
    const functionDeclarations = toGeminiFunctionDeclarations(spec.tools);
    const functionDeclarationsJson = computeFunctionDeclarationsJson(spec.tools);
    const tools: Tool[] | undefined =
      functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined;

    const attemptCreate = async (extraDeficitTokens: number): Promise<CachedContent> =>
      cacheManager.create({
        model: normalizeModelName(spec.modelName),
        displayName: spec.displayName,
        systemInstruction: spec.staticSystemInstruction,
        contents: buildCacheSeedContents(spec, functionDeclarationsJson, extraDeficitTokens),
        ...(tools ? { tools } : {}),
        ttlSeconds: spec.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      });

    try {
      let created: CachedContent;
      try {
        created = await attemptCreate(0);
      } catch (error) {
        const shortfall = parseCacheTooSmallShortfall(error);
        if (shortfall === null) {
          throw error;
        }

        // Pad beyond the reported shortfall so tokenizer variance in the padding
        // text itself can't land the retry right back on the boundary.
        created = await attemptCreate(shortfall + computeSafetyMarginTokens(shortfall));
      }

      if (!created.name) {
        getLogger().warn("Gemini context cache creation returned no cache name.");
        return null;
      }

      caches.set(fingerprint, created);
      return toCacheHandle(created, spec.modelName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().warn(`Gemini context cache creation failed; using uncached path. ${message}`);
      return null;
    }
  };

  return {
    async getOrCreate(spec: ContextCacheSpec): Promise<ContextCacheHandle | null> {
      if (!enabled) {
        return null;
      }

      const fingerprint = fingerprintContextCacheSpec(spec);
      const existing = caches.get(fingerprint);
      if (existing?.name) {
        return toCacheHandle(existing, spec.modelName);
      }

      let pending = pendingCreates.get(fingerprint);
      if (!pending) {
        pending = createCache(spec, fingerprint).finally(() => {
          pendingCreates.delete(fingerprint);
        });
        pendingCreates.set(fingerprint, pending);
      }

      return pending;
    },
  };
};

export const createCachedGeminiModel = (
  apiKey: string,
  modelName: string,
  handle: Pick<ContextCacheHandle, "cacheName" | "model">,
  temperature = 0,
): ChatGoogleGenerativeAI => {
  const model = new ChatGoogleGenerativeAI({
    apiKey,
    model: modelName,
    temperature,
  });

  // Gemini's getGenerativeModelFromCachedContent requires both name and model.
  model.useCachedContent({
    name: handle.cacheName,
    model: handle.model,
  } as CachedContent);
  return model;
};

export const isGeminiContextCacheEnabled = (): boolean => {
  const raw = process.env.GEMINI_CONTEXT_CACHE;
  return raw === undefined || (raw !== "0" && raw.toLowerCase() !== "false");
};
