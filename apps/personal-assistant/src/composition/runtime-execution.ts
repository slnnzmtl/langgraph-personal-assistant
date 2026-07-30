import {
  createRuntimeShellHooks,
  enrichRuntimeAgentPrompt,
  type CapabilityCatalog,
  type ContextCacheKit,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentPolicy,
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
import {
  createDefaultRuntimeAgentPolicy,
  type DefaultRuntimePolicyOptions,
} from "../policies/runtime-agent-policy.js";
import { createCachedGeminiModel } from "@personal-assistant/llm-gemini";

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
  createRuntimeAgentPolicy?: (
    shellHooks: RuntimeAgentNodeHooks,
    options: DefaultRuntimePolicyOptions,
  ) => RuntimeAgentPolicy;
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

  const policyOptions: DefaultRuntimePolicyOptions = {
    capabilityCatalog: options.capabilityCatalog,
    resolveTools,
    ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
    shellFormatters,
    ...(contextCache ? { contextCache } : {}),
  };

  const createPolicy = options.createRuntimeAgentPolicy ?? createDefaultRuntimeAgentPolicy;

  return {
    loadPromptByKey: loadSystemPromptByKey,
    runtimeAgentPolicy: createPolicy(genericShellHooks, policyOptions),
    shellFormatters,
    buildSupervisorDynamicContext: loadSupervisorDynamicContext,
    ...(contextCache ? { contextCache } : {}),
  };
};
