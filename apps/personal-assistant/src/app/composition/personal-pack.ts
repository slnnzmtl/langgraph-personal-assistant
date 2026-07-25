import type { AppConfig } from "../../config.js";
import path from "node:path";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import type { RuntimeCronService } from "../../cron/types.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "../../cron-triggers.js";
import {
  createRuntimeAgentRepository,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
  type CapabilityCatalog,
  type ILLMConnector,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type SkillCatalog,
  type SupervisorGraphHooks,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { loadSupervisorSystemPrompt } from "../../agents/load-system-prompt.js";
import {
  createCapabilityDeps,
  type CapabilityDeps,
} from "../../runtime-agents/builtin-capabilities.js";
import { setupSupabaseSession } from "../../services/supabase.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { createSkillCatalog } from "../../runtime-agents/skills/skill-catalog.js";
import { buildModelRegistry } from "../model-registry.js";
import { createAppExecutionKit } from "../register-defaults.js";
import {
  applyLocalModuleAvailability,
  CONFIGURATOR_AGENT_ID,
  createConfiguratorAwareRuntimeAgentRepository,
  type ConfiguratorAwareRuntimeAgentRepository,
} from "./bootstrap-agents.js";

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
};

type PersonalAdapters = { supabaseSession?: SupabaseMcpSession | undefined };

export const buildPersonalSkillCatalog = (agents: RuntimeAgentDefinition[]): SkillCatalog =>
  createSkillCatalog({
    approvedModules: [CONFIGURATOR_AGENT_ID, ...deriveSkillModules(agents)],
  });

export const buildPersonalCronGraphHooks = (
  cronTargetAgentIds: readonly string[],
): Pick<SupervisorGraphHooks, "cronTriggerResolver"> => {
  const cronTriggerResolver = createCronTriggerResolver(cronTargetAgentIds);

  return {
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) =>
        cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
  };
};

export const buildPersonalCapabilityDeps = (
  obsidianVaultPath: string,
  options: {
    cronTargetAgentIds: readonly string[];
    capabilityCatalog: CapabilityCatalog;
    skillCatalog: SkillCatalog;
    cronJobRepository?: ReturnType<typeof createCronJobRepositoryForConfig>;
    runtimeAgentRepository?: RuntimeAgentRepository;
    supabaseSession?: SupabaseMcpSession;
    fileSender?: IFileSender;
    runtimeCron?: RuntimeCronService;
  },
): CapabilityDeps =>
  createCapabilityDeps(obsidianVaultPath, {
    cronTargetAgentIds: options.cronTargetAgentIds,
    capabilityCatalog: options.capabilityCatalog,
    skillCatalog: options.skillCatalog,
    ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
    ...(options.runtimeAgentRepository
      ? { runtimeAgentRepository: options.runtimeAgentRepository }
      : {}),
    ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
    ...(options.fileSender ? { fileSender: options.fileSender } : {}),
    ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
  });

export type BuildPersonalSupervisorPackInput = {
  config: AppConfig;
  options?: SupervisorSystemOptions;
  supervisorLlm: ILLMConnector;
  capabilityCatalog: CapabilityCatalog;
};

export const buildPersonalSupervisorPack = ({
  config,
  options = {},
  supervisorLlm,
  capabilityCatalog,
}: BuildPersonalSupervisorPackInput): SupervisorPackBootstrap<
  AppConfig,
  CapabilityDeps,
  PersonalAdapters
> => ({
  config,
  capabilityCatalog,
  supervisorLlm,
  loadSupervisorPrompt: loadSupervisorSystemPrompt,
  createRuntimeAgentRepository: (appConfig) =>
    createConfiguratorAwareRuntimeAgentRepository(
      createRuntimeAgentRepository(
        process.cwd(),
        path.relative(process.cwd(), appConfig.runtimeAgentsFilePath),
      ),
    ),
  createCronJobRepository: (cronJobsFilePath, targetAgentIds) =>
    createCronJobRepositoryForConfig(cronJobsFilePath, targetAgentIds),
  setupAdapters: async (appConfig) => ({
    supabaseSession: await setupSupabaseSession(appConfig),
  }),
  seedAgents: async (repository, { adapters }) => {
    const configuratorRepository = repository as ConfiguratorAwareRuntimeAgentRepository;
    await configuratorRepository.purgeLegacyConfigurator();

    return applyLocalModuleAvailability(await repository.loadAgents(), {
      supabaseAvailable: adapters.supabaseSession !== undefined,
    });
  },
  buildSkillCatalog: buildPersonalSkillCatalog,
  buildPolicyRegistry: (agents, skillCatalog) =>
    createAppExecutionKit(deriveExecutors(agents), { skillCatalog, capabilityCatalog }),
  buildModels: (appConfig, agents) =>
    buildModelRegistry(appConfig, deriveModelKeys(agents, "generic")),
  buildCapabilityDeps: (context) =>
    buildPersonalCapabilityDeps(context.config.obsidianVaultPath, {
      cronTargetAgentIds: context.cronTargetAgentIds,
      cronJobRepository: context.cronJobRepository as ReturnType<
        typeof createCronJobRepositoryForConfig
      >,
      runtimeAgentRepository: context.runtimeAgentRepository,
      capabilityCatalog: context.capabilityCatalog,
      skillCatalog: context.skillCatalog,
      ...(options.fileSender ? { fileSender: options.fileSender } : {}),
      ...(context.adapters.supabaseSession
        ? { supabaseSession: context.adapters.supabaseSession }
        : {}),
      ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
    }),
  buildGraphHooks: (context) => ({
    promptLogging: logSystemPromptInvocation,
    ...buildPersonalCronGraphHooks(context.cronTargetAgentIds),
  }),
});
