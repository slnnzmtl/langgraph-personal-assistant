import type { AppConfig } from "../config.js";
import path from "node:path";
import {
  createCronJobRepositoryForConfig,
  createCronTriggerResolver,
  createFilePromptLogger,
  createSkillCatalog,
  createRuntimeAgentRepository,
  deriveModelKeys,
  deriveSkillModules,
  DEFAULT_MODEL_KEY,
  SYSTEM_AGENT_ID,
  SUPERVISE_CRON_ROUTE,
  type CapabilityCatalog,
  type CapabilityProvider,
  type CronJobRepository,
  type ILLMConnector,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
  type SupervisorGraphHooks,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import { setupSupabaseSession } from "../integrations/supabase.js";
import { loadSupervisorSystemPrompt, loadSystemPromptByKey } from "../prompts/load.js";
import { createDataAgentPromptStore } from "../prompts/prompt-store.js";
import {
  createCapabilityDeps,
  createPersonalCapabilityProviders,
  type PersonalCapabilityDeps,
} from "../runtime-agents/capabilities.js";
import type { IFileSender } from "../ports/file-sender.js";
import { buildModelRegistry } from "./model-registry.js";
import { buildAppRuntimeExecution } from "./runtime-execution.js";
import { prepareRuntimeAgents } from "./runtime-agent-defaults.js";

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
  loadPromptByKey?: PersonalCapabilityDeps["loadPromptByKey"];
};

export const buildPersonalSkillCatalog = (agents: RuntimeAgentDefinition[]): SkillCatalog =>
  createSkillCatalog({
    skillsDir: path.resolve(process.cwd(), "data/skills"),
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
): PersonalCapabilityDeps =>
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
    ...(options.loadPromptByKey ? { loadPromptByKey: options.loadPromptByKey } : {}),
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
  PersonalCapabilityDeps,
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
      createDataAgentPromptStore(),
    ),
  createCronJobRepository: createCronJobRepositoryForConfig,
  setupAdapters: async (appConfig) => ({
    supabaseSession: await setupSupabaseSession(appConfig),
  }),
  seedAgents: async (repository, { adapters }) =>
    prepareRuntimeAgents(await repository.loadAgents(), {
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
      loadPromptByKey: loadSystemPromptByKey,
    }),
  buildGraphHooks: (context) => ({
    promptLogging: createFilePromptLogger({
      enabled: () => process.env.ENABLE_PROMPT_LOGS !== "false",
    }),
    ...buildPersonalCronGraphHooks(context.cronTargetAgentIds),
  }),
});
