import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { CapabilityCatalog, CapabilityProvider } from "../capabilities/index.js";
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
  /** Pre-built catalog when capabilityProviders is not supplied (e.g. minimal test packs). */
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
  /** Primary catalog source; merged with system-config capabilities when systemAgent is enabled. */
  capabilityProviders?: CapabilityProvider<Record<string, unknown>>[];
  buildModels: (config: TConfig, agents: RuntimeAgentDefinition[]) => Record<string, BaseChatModel>;
  buildCapabilityDeps: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => TDeps;
  /** Prefer `buildGraphHooks` for context-aware hooks. Static hooks remain for legacy packs. */
  graphHooks?: SupervisorGraphHooks;
  buildGraphHooks?: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => SupervisorGraphHooks;
  setupAdapters?: (config: TConfig) => Promise<TAdapters>;
  /** Non-grantable capabilities allowed only on specific persisted agent ids (e.g. finance → finance-domain). */
  reservedCapabilitiesByAgentId?: Record<string, readonly string[]>;
  validatePersistedAgents?: (
    agents: RuntimeAgentDefinition[],
    catalog: CapabilityCatalog,
    deps: TDeps,
  ) => void;
  createCheckpointer?: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => BaseCheckpointSaver | Promise<BaseCheckpointSaver>;
};
