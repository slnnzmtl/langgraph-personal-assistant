import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { StructuredToolInterface } from "@langchain/core/tools";

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
import type { SystemAgentOptions } from "./system-agent/types.js";

/** Minimal cron repository contract for pack bootstrap (duck-types cron impl). */
export type CronJobRepository = {
  loadJobs(): Promise<unknown[]>;
  saveJobs(jobs: unknown[]): Promise<void>;
  createJob(job: unknown): Promise<unknown>;
  deleteJob(jobName: string): Promise<unknown>;
};

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
> = {
  config: TConfig;
  graph: CompiledSupervisorGraph;
  cronJobRepository: CronJobRepository;
  cronTargetAgentIds: readonly string[];
  runtimeAgents: RuntimeAgentDefinition[];
  skillCatalog: SkillCatalog;
  capabilityDeps: TDeps;
};

export type SupervisorPackBootstrap<
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  config: TConfig;
  capabilityCatalog: CapabilityCatalog;
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
  buildPolicyRegistry: (
    agents: RuntimeAgentDefinition[],
    skillCatalog: SkillCatalog,
  ) => {
    loadPromptByKey: LoadPromptByKey;
    policies: RuntimeAgentPolicy[];
    shellFormatters?: RuntimeShellFormatters;
  };
  /** When set, bootstrap wires virtual system agent repo wrap, capability merge, and policy. */
  systemAgent?: SystemAgentOptions | false;
  capabilityProviders?: CapabilityProvider<Record<string, unknown>>[];
  resolveRuntimeAgentTools?: (
    catalog: CapabilityCatalog,
    skillCatalog: SkillCatalog,
  ) => (
    definition: RuntimeAgentDefinition,
    capabilityDeps: TDeps,
    resolveOptions?: Record<string, unknown>,
  ) => StructuredToolInterface[];
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
