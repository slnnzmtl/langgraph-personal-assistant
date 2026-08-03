import { SystemMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  buildCachedRuntimePromptMessages,
  buildRuntimeAgentPromptMessages,
  buildRuntimePromptParts,
  type ContextCacheKit,
  type RuntimeAgentDefinition,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentTurnContext,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";

export type ContextCacheRuntimeAgentOptions = {
  modelName: string;
  skillCatalog: SkillCatalog;
  shellFormatters: RuntimeShellFormatters;
  displayName: string;
  resolveExtraDynamicSections?: (
    ctx: RuntimeAgentTurnContext,
  ) => Promise<readonly string[]> | readonly string[];
};

const resolvePromptParts = async (
  ctx: RuntimeAgentTurnContext,
  kit: ContextCacheKit,
  options: ContextCacheRuntimeAgentOptions,
) => {
  const formatSystemMetadata = options.shellFormatters.formatSystemMetadata;
  const metadata = formatSystemMetadata(new Date(), { runtimeAgent: ctx.definition.name });
  const extras = options.resolveExtraDynamicSections
    ? await options.resolveExtraDynamicSections(ctx)
    : [];

  return buildRuntimePromptParts(
    ctx.basePrompt,
    ctx.definition,
    ctx.state.agentMessages,
    options.skillCatalog,
    metadata,
    extras,
  );
};

const getPromptParts = async (
  ctx: RuntimeAgentTurnContext,
  kit: ContextCacheKit,
  options: ContextCacheRuntimeAgentOptions,
) => {
  ctx.resolvedPromptParts ??= await resolvePromptParts(ctx, kit, options);
  return ctx.resolvedPromptParts;
};

export const createContextCacheRuntimeConfig = (
  kit: ContextCacheKit,
  options: ContextCacheRuntimeAgentOptions,
): Pick<
  RuntimeAgentNodeConfig,
  "buildSystemPrompt" | "buildPromptMessages" | "resolveModelForTurn"
> => ({
  buildSystemPrompt: async (ctx) => {
    const parts = await getPromptParts(ctx, kit, options);

    if (ctx.useCachedPromptLayout) {
      return parts.dynamicPrompt;
    }

    return parts.dynamicPrompt.length > 0
      ? `${parts.staticPrompt}\n\n${parts.dynamicPrompt}`
      : parts.staticPrompt;
  },
  buildPromptMessages: (ctx, systemPromptText, stateMessages) => {
    if (ctx.useCachedPromptLayout) {
      return buildCachedRuntimePromptMessages(systemPromptText, stateMessages);
    }

    return buildRuntimeAgentPromptMessages(new SystemMessage(systemPromptText), stateMessages);
  },
  resolveModelForTurn: async (ctx, baseModel, toolsForTurn: StructuredToolInterface[]) => {
    const parts = await getPromptParts(ctx, kit, options);
    const cacheSpec = {
      modelName: options.modelName,
      staticSystemInstruction: parts.staticPrompt,
      tools: toolsForTurn,
      displayName: options.displayName,
    };
    const uncachedTurn = () => ({
      model: baseModel,
      bindTools: toolsForTurn.length > 0,
      useCachedPromptLayout: false,
    });
    const handle = await kit.cacheManager.getOrCreate(cacheSpec);

    if (!handle) {
      return uncachedTurn();
    }

    return {
      model: kit.createCachedModel(kit.apiKey, options.modelName, handle),
      bindTools: false,
      useCachedPromptLayout: true,
      recoverFromCachedContentMiss: async () => {
        kit.cacheManager.invalidate(handle.cacheName);
        const recreated = await kit.cacheManager.getOrCreate(cacheSpec);
        if (!recreated) {
          return uncachedTurn();
        }

        return {
          model: kit.createCachedModel(kit.apiKey, options.modelName, recreated),
          bindTools: false,
          useCachedPromptLayout: true,
        };
      },
    };
  },
});

/** Overlay Gemini context-cache prompt/model hooks onto base runtime shell hooks. */
export const mergeRuntimeCacheHooks = (
  baseHooks: RuntimeAgentNodeHooks,
  definition: RuntimeAgentDefinition,
  shellFormatters: RuntimeShellFormatters,
  skillCatalog: SkillCatalog | undefined,
  contextCache: ContextCacheKit | undefined,
  resolveExtraDynamicSections?: ContextCacheRuntimeAgentOptions["resolveExtraDynamicSections"],
): RuntimeAgentNodeHooks => {
  if (!contextCache || !skillCatalog) {
    return baseHooks;
  }

  return {
    ...baseHooks,
    ...createContextCacheRuntimeConfig(contextCache, {
      modelName: contextCache.resolveRuntimeModelName(definition),
      skillCatalog,
      shellFormatters,
      displayName: `runtime-agent-${definition.id}`,
      ...(resolveExtraDynamicSections ? { resolveExtraDynamicSections } : {}),
    }),
  };
};
