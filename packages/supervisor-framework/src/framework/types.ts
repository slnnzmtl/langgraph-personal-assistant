import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

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
import type { RuntimeShellFormatters } from "../core/system-context.js";
import type { SystemAgentOptions } from "./system-agent/definition.js";
import type { CronJobRepository } from "./cron/types.js";

export type { CronJobRepository };

export type SupervisorPaths = {
  runtimeAgentsFilePath: string;
  cronJobsFilePath: string;
  messageHistoryMaxTokens?: number;
};

export type SupervisorGraphHooks = {
  replyUx?: ReplyUxConfig;
  promptLogging?: PromptLoggingHook;
  cronTriggerResolver?: AssistantConfig["cronTriggerResolver"];
  messageHistoryMaxTokens?: number;
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
  createRuntimeAgentRepository?: (config: TConfig) => RuntimeAgentRepository;
  createCronJobRepository?: (
    cronJobsFilePath: string,
    cronTargetAgentIds: readonly string[],
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
  graphHooks?: SupervisorGraphHooks;
  buildGraphHooks?: (
    ctx: SupervisorBootstrapContext<TConfig, TDeps, TAdapters>,
  ) => SupervisorGraphHooks;
  setupAdapters?: (config: TConfig) => Promise<TAdapters>;
};
