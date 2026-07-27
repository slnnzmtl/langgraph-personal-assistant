import type { AppConfig } from "../config.js";
import path from "node:path";
import { createCronJobRepositoryForConfig } from "../cron/cron-job-repository.js";
import type { CronJobRepository, RuntimeCronService } from "../cron/types.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "../cron/cron-triggers.js";
import {
  createRuntimeAgentRepository,
  deriveModelKeys,
  deriveSkillModules,
  DEFAULT_MODEL_KEY,
  SYSTEM_AGENT_ID,
  type CapabilityCatalog,
  type CapabilityProvider,
  type ILLMConnector,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type SkillCatalog,
  type SupervisorGraphHooks,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import { loadSupervisorSystemPrompt } from "../agents/load-system-prompt.js";
import {
  createCapabilityDeps,
  createPersonalCapabilityProviders,
  type CapabilityDeps,
} from "../runtime-agents/builtin-capabilities.js";
import { setupSupabaseSession } from "../services/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import { createSkillCatalog } from "../runtime-agents/skills/skill-catalog.js";
import { buildModelRegistry } from "./model-registry.js";
import { buildAppRuntimeExecution } from "./runtime-execution.js";
import { applyLocalModuleAvailability } from "./bootstrap-agents.js";

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
};

type PersonalAdapters = { supabaseSession?: SupabaseMcpSession | undefined };

type PersonalCapabilityDepsOptions = {
  cronTargetAgentIds: readonly string[];
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  cronJobRepository?: CronJobRepository | undefined;
  runtimeAgentRepository?: RuntimeAgentRepository | undefined;
  supabaseSession?: SupabaseMcpSession | undefined;
  fileSender?: IFileSender | undefined;
  runtimeCron?: RuntimeCronService | undefined;
};

export const buildPersonalSkillCatalog = (agents: RuntimeAgentDefinition[]): SkillCatalog =>
  createSkillCatalog({
    approvedModules: [SYSTEM_AGENT_ID, ...deriveSkillModules(agents)],
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

/** Stricter personal entry over `createCapabilityDeps`; strips undefined optionals for EOPT. */
export const buildPersonalCapabilityDeps = (
  obsidianVaultPath: string,
  options: PersonalCapabilityDepsOptions,
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
};

export const buildPersonalSupervisorPack = ({
  config,
  options = {},
  supervisorLlm,
}: BuildPersonalSupervisorPackInput): SupervisorPackBootstrap<
  AppConfig,
  CapabilityDeps,
  PersonalAdapters
> => ({
  config,
  capabilityProviders: createPersonalCapabilityProviders() as CapabilityProvider<
    Record<string, unknown>
  >[],
  supervisorLlm,
  loadSupervisorPrompt: loadSupervisorSystemPrompt,
  systemAgent: {
    modelKey: "configuration",
  },
  createRuntimeAgentRepository: (appConfig) =>
    createRuntimeAgentRepository(
      process.cwd(),
      path.relative(process.cwd(), appConfig.runtimeAgentsFilePath),
    ),
  createCronJobRepository: createCronJobRepositoryForConfig,
  setupAdapters: async (appConfig) => ({
    supabaseSession: await setupSupabaseSession(appConfig),
  }),
  seedAgents: async (repository, { adapters }) =>
    applyLocalModuleAvailability(await repository.loadAgents(), {
      supabaseAvailable: adapters.supabaseSession !== undefined,
    }),
  buildSkillCatalog: buildPersonalSkillCatalog,
  buildRuntimeExecution: (_agents, skillCatalog, ctx) =>
    buildAppRuntimeExecution({ skillCatalog, capabilityCatalog: ctx.capabilityCatalog }),
  buildModels: (appConfig, agents) =>
    buildModelRegistry(appConfig, deriveModelKeys(agents, DEFAULT_MODEL_KEY)),
  buildCapabilityDeps: (context) =>
    buildPersonalCapabilityDeps(context.config.obsidianVaultPath, {
      cronTargetAgentIds: context.cronTargetAgentIds,
      cronJobRepository: context.cronJobRepository as CronJobRepository,
      runtimeAgentRepository: context.runtimeAgentRepository,
      capabilityCatalog: context.capabilityCatalog,
      skillCatalog: context.skillCatalog,
      fileSender: options.fileSender,
      supabaseSession: context.adapters.supabaseSession,
      runtimeCron: options.runtimeCron,
    }),
  buildGraphHooks: (context) => ({
    promptLogging: logSystemPromptInvocation,
    ...buildPersonalCronGraphHooks(context.cronTargetAgentIds),
  }),
});
