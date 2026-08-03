import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { CapabilityCatalog } from "../capabilities/catalog.js";
import type { CapabilityProvider } from "../capabilities/types.js";
import type { LoadPromptByKey } from "../core/agents/resolve-system-prompt.js";
import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import type { createAssistant, AssistantConfig } from "../core/create-assistant.js";
import type { ILLMConnector } from "../core/ports/llm-connector.js";
import type { PromptLoggingHook } from "../core/ports/prompt-logging.js";
import type { RuntimeAgentPolicy } from "../core/types/policy.js";
import type { ReplyUxConfig } from "../core/supervisor/reply-ux.js";
import type { SkillCatalog } from "../core/skills/catalog.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import type { ContextCacheKit } from "../core/llm/context-cache-types.js";
import type { RuntimeShellFormatters } from "../core/system-context.js";
import type { SystemAgentOptions } from "./system-agent/definition.js";
import type { CronJobRepository } from "./cron/types.js";
import type { CronTargetAgentIdsSource } from "./cron/cron-job-repository.js";

export type { CronJobRepository };

export type SupervisorPaths = {
  runtimeAgentsFilePath: string;
  cronJobsFilePath: string;
  messageHistoryMaxTokens?: number;
  /** When false, bootstrap skips data mutations (default true). */
  allowDataWrites?: boolean;
};

export type SupervisorGraphHooks = {
  replyUx?: ReplyUxConfig;
  promptLogging?: PromptLoggingHook;
  cronTriggerResolver?: AssistantConfig["cronTriggerResolver"];
  messageHistoryMaxTokens?: number;
  checkpointer?: BaseCheckpointSaver;
};

export type CompiledSupervisorGraph = ReturnType<typeof createAssistant>;

export type SupervisorBootstrapContext<
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  config: TConfig;
  runtimeAgentRepository: RuntimeAgentRepository;
  runtimeAgents: RuntimeAgentDefinition[];
  cronTargetAgentIds: readonly string[];
  cronJobRepository: CronJobRepository;
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  adapters: TAdapters;
};

/**
 * Context available when building capability providers on each bootstrap.
 * Invoked after setupAdapters (and repos/skills), before the catalog exists.
 */
export type CapabilityProvidersBootstrapContext<
  TConfig extends SupervisorPaths,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  config: TConfig;
  adapters: TAdapters;
  runtimeAgentRepository: RuntimeAgentRepository;
  runtimeAgents: RuntimeAgentDefinition[];
  cronTargetAgentIds: readonly string[];
  cronJobRepository: CronJobRepository;
  skillCatalog: SkillCatalog;
};

export type SupervisorSystemContext<
  TConfig extends SupervisorPaths = SupervisorPaths,
  TDeps extends Record<string, unknown> = Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  config: TConfig;
  graph: CompiledSupervisorGraph;
  runtimeAgentRepository: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  cronTargetAgentIds: readonly string[];
  runtimeAgents: RuntimeAgentDefinition[];
  skillCatalog: SkillCatalog;
  capabilityDeps: TDeps;
  adapters: TAdapters;
};

export type RuntimeExecutionKit = {
  loadPromptByKey: LoadPromptByKey;
  runtimeAgentPolicy: RuntimeAgentPolicy;
  shellFormatters?: RuntimeShellFormatters;
  buildSupervisorDynamicContext?: () => string;
  contextCache?: ContextCacheKit;
};

export type InitializeDefaultsContext<TConfig extends SupervisorPaths> = {
  config: TConfig;
  systemAgentEnabled: boolean;
};

export type SupervisorPackBootstrap<
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  config: TConfig;
  /** Escape hatch for minimal packs/tests that supply a pre-built catalog. Exactly one of `buildCapabilityProviders` or `capabilityCatalog` is required. */
  capabilityCatalog?: CapabilityCatalog;
  supervisorLlm: ILLMConnector;
  loadSupervisorPrompt: () => string;
  /** Optional early hook for seeding default prompts/skills before repositories and catalogs load. */
  initializeDefaults?: (
    context: InitializeDefaultsContext<TConfig>,
  ) => Promise<void> | void;
  createRuntimeAgentRepository?: (config: TConfig) => RuntimeAgentRepository;
  createCronJobRepository?: (
    cronJobsFilePath: string,
    cronTargetAgentIds: CronTargetAgentIdsSource,
  ) => CronJobRepository;
  seedAgents: (
    repository: RuntimeAgentRepository,
    context: { adapters: TAdapters },
  ) => Promise<RuntimeAgentDefinition[]>;
  buildSkillCatalog?: (agents: RuntimeAgentDefinition[]) => SkillCatalog;
  buildRuntimeExecution: (
    agents: RuntimeAgentDefinition[],
    skillCatalog: SkillCatalog,
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => RuntimeExecutionKit;
  /** When set, bootstrap wires virtual system agent repo wrap, capability merge, and policy. */
  systemAgent?: SystemAgentOptions | false;
  /**
   * Preferred catalog source: invoked after setupAdapters on every bootstrap so providers
   * can close over fresh adapter clients (safe for soft recompile).
   * Exactly one of `buildCapabilityProviders` or `capabilityCatalog` is required.
   */
  buildCapabilityProviders?: (
    ctx: CapabilityProvidersBootstrapContext<TConfig, TAdapters>,
  ) => CapabilityProvider<Record<string, unknown>>[];
  buildModels: (config: TConfig, agents: RuntimeAgentDefinition[]) => Record<string, BaseChatModel>;
  buildCapabilityDeps: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => TDeps;
  buildGraphHooks?: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => SupervisorGraphHooks;
  setupAdapters?: (config: TConfig) => Promise<TAdapters>;
  validatePersistedAgents?: (
    agents: RuntimeAgentDefinition[],
    catalog: CapabilityCatalog,
    deps: TDeps,
  ) => void;
  createCheckpointer?: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => BaseCheckpointSaver | Promise<BaseCheckpointSaver>;
};
