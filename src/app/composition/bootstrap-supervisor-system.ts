import path from "node:path";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AppConfig } from "../../config.js";
import { createWorkflowGraph } from "../../agent.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import type { RuntimeCronService } from "../../cron/types.js";
import { createRuntimeAgentRepository } from "../../core/agents/repository.js";
import type { LoadPromptByKey } from "../../core/agents/resolve-system-prompt.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import type { PolicyRegistry } from "../../core/policies/registry.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentModelKey } from "../../core/types/agent.js";
import type { CapabilityCatalog } from "../../capabilities/index.js";
import type { SkillCatalog } from "../../core/skills/catalog.js";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { buildSkillModuleOwnerPattern } from "./bootstrap-agents.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";

export const deriveModelKeys = (
  agents: RuntimeAgentDefinition[],
  defaultModelKey = "generic",
): Set<string> => {
  const keys = new Set<string>([defaultModelKey]);

  for (const agent of agents) {
    keys.add(resolveAgentModelKey(agent, defaultModelKey));
  }

  return keys;
};

export const deriveExecutors = (agents: RuntimeAgentDefinition[]): Set<string> =>
  new Set(agents.map((agent) => agent.executor ?? "generic"));

export const deriveSkillModules = (agents: RuntimeAgentDefinition[]): string[] =>
  [...new Set(agents.map((agent) => agent.promptSourceKey ?? agent.id))];

export const deriveCronTargetAgentIds = (agents: RuntimeAgentDefinition[]): string[] =>
  agents.filter((agent) => agent.enabled).map((agent) => agent.id);

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
};

export type SupervisorSystemContext = {
  config: AppConfig;
  graph: ReturnType<typeof createWorkflowGraph>;
  cronJobRepository: ReturnType<typeof createCronJobRepositoryForConfig>;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  supabaseSession?: SupabaseMcpSession;
  skillModulePattern: RegExp;
};

export type SupervisorBootstrapContext = {
  config: AppConfig;
  runtimeAgentRepository: RuntimeAgentRepository;
  runtimeAgents: RuntimeAgentDefinition[];
  cronTargetAgentIds: readonly string[];
  cronJobRepository: ReturnType<typeof createCronJobRepositoryForConfig>;
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  supabaseSession?: SupabaseMcpSession;
  options: SupervisorSystemOptions;
};

export type SupervisorPackBootstrap = {
  config: AppConfig;
  capabilityCatalog: CapabilityCatalog;
  seedAgents: (
    repository: RuntimeAgentRepository,
    context: { supabaseAvailable: boolean },
  ) => Promise<RuntimeAgentDefinition[]>;
  buildSkillCatalog: (agents: RuntimeAgentDefinition[]) => SkillCatalog;
  buildPolicyRegistry: (
    agents: RuntimeAgentDefinition[],
    skillCatalog: SkillCatalog,
  ) => { loadPromptByKey: LoadPromptByKey; policyRegistry: PolicyRegistry };
  buildModels: (config: AppConfig, agents: RuntimeAgentDefinition[]) => Record<string, BaseChatModel>;
  buildCapabilityDeps: (context: SupervisorBootstrapContext) => CapabilityDeps;
  setupAdapters?: (config: AppConfig) => Promise<{ supabaseSession?: SupabaseMcpSession }>;
  options?: SupervisorSystemOptions;
};

export const bootstrapSupervisorSystem = async (
  pack: SupervisorPackBootstrap,
): Promise<SupervisorSystemContext> => {
  const options = pack.options ?? {};
  const supervisorConnector = new GeminiConnector(pack.config.googleApiKey, pack.config.supervisorModel);
  const adapters = pack.setupAdapters ? await pack.setupAdapters(pack.config) : {};
  const supabaseSession = adapters.supabaseSession;

  const runtimeAgentRepository = createRuntimeAgentRepository(
    process.cwd(),
    path.relative(process.cwd(), pack.config.runtimeAgentsFilePath),
  );

  const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, {
    supabaseAvailable: supabaseSession !== undefined,
  });

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const cronJobRepository = createCronJobRepositoryForConfig(
    pack.config.cronJobsFilePath,
    cronTargetAgentIds,
  );
  const skillCatalog = pack.buildSkillCatalog(runtimeAgents);

  const bootstrapContext: SupervisorBootstrapContext = {
    config: pack.config,
    runtimeAgentRepository,
    runtimeAgents,
    cronTargetAgentIds,
    cronJobRepository,
    capabilityCatalog: pack.capabilityCatalog,
    skillCatalog,
    options,
    ...(supabaseSession ? { supabaseSession } : {}),
  };

  const capabilityDeps = pack.buildCapabilityDeps(bootstrapContext);
  const defaultModelKey = "generic";
  const models = pack.buildModels(pack.config, runtimeAgents);
  const { loadPromptByKey, policyRegistry } = pack.buildPolicyRegistry(runtimeAgents, skillCatalog);

  const graph = createWorkflowGraph({
    supervisorLlm: supervisorConnector,
    models,
    runtimeAgents,
    defaultModelKey,
    cronTargetAgentIds,
    runtimeAgentRepository,
    loadPromptByKey,
    policyRegistry,
    bundleDeps: capabilityDeps,
    messageHistoryMaxTokens: pack.config.messageHistoryMaxTokens,
  });

  return {
    config: pack.config,
    graph,
    cronJobRepository,
    cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(skillCatalog.listModules()),
    ...(supabaseSession ? { supabaseSession } : {}),
  };
};
