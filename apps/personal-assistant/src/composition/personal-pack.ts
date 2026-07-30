import type { AppConfig } from "../config.js";
import path from "node:path";
import {
  createCronJobRepositoryForConfig,
  createCronTriggerResolver,
  createDefaultContentSeeder,
  createFilePromptLogger,
  createSkillCatalog,
  createRuntimeAgentRepository,
  getLogger,
  deriveModelKeys,
  deriveSkillModules,
  DEFAULT_MODEL_KEY,
  resolveAgentModelKey,
  SYSTEM_AGENT_ID,
  SUPERVISE_CRON_ROUTE,
  type CapabilityCatalog,
  type CapabilityProvider,
  type CronJobRepository,
  type CronTargetAgentIdsSource,
  type ILLMConnector,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
  type SupervisorGraphHooks,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import { createObsidianVault } from "../integrations/obsidian.js";
import { createFetchWiseTransactions } from "../integrations/wise.js";
import type { FetchWiseTransactions } from "../ports/wise-transactions.js";
import { loadSupervisorSystemPrompt, loadSystemPromptByKey } from "../prompts/load.js";
import { createDataAgentPromptStore } from "../prompts/prompt-store.js";
import {
  createCapabilityDeps,
  createPersonalCapabilityProviders,
  PERSONAL_RESERVED_CAPABILITIES_BY_AGENT_ID,
  type PersonalCapabilityDeps,
} from "../runtime-agents/capabilities.js";
import type { IFileSender } from "../ports/file-sender.js";
import type { SqlSession } from "../ports/sql-session.js";
import { buildModelRegistry } from "./model-registry.js";
import { buildAppRuntimeExecution } from "./runtime-execution.js";
import {
  prepareRuntimeAgents,
  resolveBuiltinModelName,
} from "./runtime-agent-defaults.js";
import {
  createGeminiContextCacheManager,
  isGeminiContextCacheEnabled,
} from "@personal-assistant/llm-gemini";
import {
  createPersonalCheckpointer,
  setupPersonalAdapters,
  type PersonalAdapters,
} from "./personal-adapters.js";

const personalDefaultContentSeeder = createDefaultContentSeeder({
  promptsDir: path.resolve(process.cwd(), "data/prompts"),
  skillsDir: path.resolve(process.cwd(), "data/skills"),
  logger: (message) => getLogger().info(message),
});

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
  /** Bot entrypoints use writer; scheduler uses reader. Default writer. */
  dataWriteRole?: "writer" | "reader";
};

type PersonalCapabilityDepsOptions = {
  cronTargetAgentIds: readonly string[];
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  cronJobRepository?: CronJobRepository | undefined;
  runtimeAgentRepository?: RuntimeAgentRepository | undefined;
  supabaseReadSession?: SqlSession | undefined;
  supabaseWriteSession?: SqlSession | undefined;
  fileSender?: IFileSender | undefined;
  fetchWiseTransactions?: FetchWiseTransactions | undefined;
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
  createCapabilityDeps({
    ...(obsidianVaultPath
      ? { obsidianVault: createObsidianVault(obsidianVaultPath) }
      : {}),
    ...(options.fetchWiseTransactions
      ? { fetchWiseTransactions: options.fetchWiseTransactions }
      : {}),
    cronTargetAgentIds: options.cronTargetAgentIds,
    capabilityCatalog: options.capabilityCatalog,
    skillCatalog: options.skillCatalog,
    ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
    ...(options.runtimeAgentRepository
      ? { runtimeAgentRepository: options.runtimeAgentRepository }
      : {}),
    ...(options.supabaseReadSession ? { supabaseReadSession: options.supabaseReadSession } : {}),
    ...(options.supabaseWriteSession ? { supabaseWriteSession: options.supabaseWriteSession } : {}),
    ...(options.fileSender ? { fileSender: options.fileSender } : {}),
    ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
    ...(options.loadPromptByKey ? { loadPromptByKey: options.loadPromptByKey } : {}),
  });

const createPersonalRuntimeAgentRepository = (appConfig: AppConfig): RuntimeAgentRepository =>
  createRuntimeAgentRepository(
    process.cwd(),
    path.relative(process.cwd(), appConfig.runtimeAgentsFilePath),
    createDataAgentPromptStore(),
  );

const createPersonalCronJobRepository = (
  cronJobsFilePath: string,
  cronTargetAgentIds: CronTargetAgentIdsSource,
): CronJobRepository =>
  createCronJobRepositoryForConfig(cronJobsFilePath, cronTargetAgentIds);

const buildPersonalRuntimeExecution = (
  config: AppConfig,
  skillCatalog: SkillCatalog,
  capabilityCatalog: CapabilityCatalog,
) => {
  const cacheManager = createGeminiContextCacheManager(
    config.googleApiKey,
    isGeminiContextCacheEnabled(),
  );

  return buildAppRuntimeExecution({
    skillCatalog,
    capabilityCatalog,
    contextCache: {
      cacheManager,
      apiKey: config.googleApiKey,
      resolveRuntimeModelName: (definition) =>
        resolveBuiltinModelName(config, resolveAgentModelKey(definition)),
      supervisorModelName: config.supervisorModel,
    },
  });
};

export type BuildPersonalSupervisorPackInput = {
  config: AppConfig;
  options?: SupervisorSystemOptions;
  supervisorLlm: ILLMConnector;
};

export { closePersonalAdapters } from "./personal-adapters.js";

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
  reservedCapabilitiesByAgentId: PERSONAL_RESERVED_CAPABILITIES_BY_AGENT_ID,
  initializeDefaults: () => {
    personalDefaultContentSeeder.seedAll();
  },
  createRuntimeAgentRepository: createPersonalRuntimeAgentRepository,
  createCronJobRepository: createPersonalCronJobRepository,
  setupAdapters: setupPersonalAdapters,
  createCheckpointer: createPersonalCheckpointer,
  seedAgents: async (repository, { adapters }) =>
    prepareRuntimeAgents(await repository.loadAgents(), {
      supabaseAvailable:
        adapters.supabaseWriteSession !== undefined || adapters.supabaseReadSession !== undefined,
    }),
  buildSkillCatalog: buildPersonalSkillCatalog,
  buildRuntimeExecution: (_agents, skillCatalog, ctx) =>
    buildPersonalRuntimeExecution(ctx.config, skillCatalog, ctx.capabilityCatalog),
  buildModels: (appConfig, agents) =>
    buildModelRegistry(appConfig, deriveModelKeys(agents, DEFAULT_MODEL_KEY)),
  buildCapabilityDeps: (context) => {
    const fetchWiseTransactions = createFetchWiseTransactions(context.config);
    return buildPersonalCapabilityDeps(context.config.obsidianVaultPath, {
      cronTargetAgentIds: context.cronTargetAgentIds,
      cronJobRepository: context.cronJobRepository as CronJobRepository,
      runtimeAgentRepository: context.runtimeAgentRepository,
      capabilityCatalog: context.capabilityCatalog,
      skillCatalog: context.skillCatalog,
      fileSender: options.fileSender,
      supabaseReadSession: context.adapters.supabaseReadSession,
      supabaseWriteSession: context.adapters.supabaseWriteSession,
      ...(fetchWiseTransactions ? { fetchWiseTransactions } : {}),
      runtimeCron: options.runtimeCron,
      loadPromptByKey: loadSystemPromptByKey,
    });
  },
  buildGraphHooks: (context) => ({
    promptLogging: createFilePromptLogger({
      enabled: () => process.env.ENABLE_PROMPT_LOGS !== "false",
    }),
    ...buildPersonalCronGraphHooks(context.cronTargetAgentIds),
  }),
});
