import {
  createRuntimeShellHooks,
  enrichRuntimeAgentPrompt,
  type CapabilityCatalog,
  type ContextCacheKit,
  type RuntimeExecutionKit,
  type RuntimeShellFormatters,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import {
  appendDynamicSections,
  formatSystemMetadata,
  loadSupervisorDynamicContext,
  loadSystemPromptByKey,
} from "../prompts/load.js";
import { createPersonalResolveTools } from "../runtime-agents/resolve-tools.js";
import { createDefaultRuntimeAgentPolicy } from "../policies/runtime-agent-policy.js";
import { createCachedGeminiModel } from "../models/gemini-context-cache.js";

export const createDefaultRuntimeShellFormatters = (
  skillCatalog?: SkillCatalog,
): RuntimeShellFormatters => ({
  formatSystemMetadata,
  appendDynamicSections,
  appendSkillAttachments: (basePrompt, definition, messages) =>
    enrichRuntimeAgentPrompt(basePrompt, definition, messages, skillCatalog),
});

export type AppRuntimeExecutionOptions = {
  capabilityCatalog: CapabilityCatalog;
  skillCatalog?: SkillCatalog | undefined;
  shellFormatters?: RuntimeShellFormatters;
  contextCache?: Omit<ContextCacheKit, "createCachedModel"> & {
    createCachedModel?: ContextCacheKit["createCachedModel"];
  };
};

/** Builds the personal pack default runtime execution kit (one generic policy + shell formatters). */
export const buildAppRuntimeExecution = (options: AppRuntimeExecutionOptions): RuntimeExecutionKit => {
  const shellFormatters = options.shellFormatters ?? createDefaultRuntimeShellFormatters(options.skillCatalog);
  const genericShellHooks = createRuntimeShellHooks(shellFormatters);
  const resolveTools = createPersonalResolveTools(options.capabilityCatalog);

  const contextCache: ContextCacheKit | undefined = options.contextCache
    ? {
        ...options.contextCache,
        createCachedModel: options.contextCache.createCachedModel ?? createCachedGeminiModel,
      }
    : undefined;

  const policyOptions = {
    capabilityCatalog: options.capabilityCatalog,
    resolveTools,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
    shellFormatters,
    ...(contextCache ? { contextCache } : {}),
  };

  return {
    loadPromptByKey: loadSystemPromptByKey,
    runtimeAgentPolicy: createDefaultRuntimeAgentPolicy(genericShellHooks, policyOptions),
    shellFormatters,
    buildSupervisorDynamicContext: loadSupervisorDynamicContext,
    ...(contextCache ? { contextCache } : {}),
  };
};
