import type { AppConfig } from "../config.js";
import path from "node:path";
import {
  createCronJobRepositoryForConfig,
  createCronTriggerResolver,
  createDefaultContentSeeder,
  createFilePromptLogger,
  createReadOnlyCronJobRepository,
  createReadOnlyRuntimeAgentRepository,
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
  type ILLMConnector,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
  type SupervisorGraphHooks,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import { MemorySaver } from "@langchain/langgraph";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import { setupSupabaseSessions } from "../integrations/supabase.js";
import { openDurabilityStore, type DurabilityStore } from "../persistence/durability-store.js";
import { loadSupervisorSystemPrompt, loadSystemPromptByKey } from "../prompts/load.js";
import { createDataAgentPromptStore } from "../prompts/prompt-store.js";
import {
  createCapabilityDeps,
  createPersonalCapabilityProviders,
  PERSONAL_RESERVED_CAPABILITIES_BY_AGENT_ID,
  type PersonalCapabilityDeps,
} from "../runtime-agents/capabilities.js";
import type { IFileSender } from "../ports/file-sender.js";
import { buildModelRegistry } from "./model-registry.js";
import { buildAppRuntimeExecution } from "./runtime-execution.js";
import { resolveBuiltinModelName } from "./runtime-agent-defaults.js";
import {
  createGeminiContextCacheManager,
  isGeminiContextCacheEnabled,
} from "../models/gemini-context-cache.js";
import { prepareRuntimeAgents } from "./runtime-agent-defaults.js";

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

type PersonalAdapters = {
  supabaseReadSession?: SupabaseMcpSession;
  supabaseWriteSession?: SupabaseMcpSession;
  durabilityStore?: DurabilityStore;
};

type PersonalCapabilityDepsOptions = {
  cronTargetAgentIds: readonly string[];
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  cronJobRepository?: CronJobRepository | undefined;
  runtimeAgentRepository?: RuntimeAgentRepository | undefined;
  supabaseReadSession?: SupabaseMcpSession | undefined;
  supabaseWriteSession?: SupabaseMcpSession | undefined;
  /** @deprecated Test/back-compat alias; maps to write session when write session is unset. */
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
    ...(options.supabaseReadSession ? { supabaseReadSession: options.supabaseReadSession } : {}),
    ...(options.supabaseWriteSession ? { supabaseWriteSession: options.supabaseWriteSession } : {}),
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
  initializeDefaults: () => {
    personalDefaultContentSeeder.seedAll();
  },
  systemAgent: {
    modelKey: "configuration",
  },
  reservedCapabilitiesByAgentId: PERSONAL_RESERVED_CAPABILITIES_BY_AGENT_ID,
  createRuntimeAgentRepository: (appConfig) => {
    const repository = createRuntimeAgentRepository(
      process.cwd(),
      path.relative(process.cwd(), appConfig.runtimeAgentsFilePath),
      createDataAgentPromptStore(),
    );

    return appConfig.allowDataWrites === false
      ? createReadOnlyRuntimeAgentRepository(repository)
      : repository;
  },
  createCronJobRepository: (cronJobsFilePath, cronTargetAgentIds) => {
    const repository = createCronJobRepositoryForConfig(cronJobsFilePath, cronTargetAgentIds);

    return config.allowDataWrites === false
      ? createReadOnlyCronJobRepository(repository)
      : repository;
  },
  setupAdapters: async (appConfig) => {
    const sessions = await setupSupabaseSessions(appConfig);
    return {
      ...(sessions.supabaseReadSession ? { supabaseReadSession: sessions.supabaseReadSession } : {}),
      ...(sessions.supabaseWriteSession
        ? { supabaseWriteSession: sessions.supabaseWriteSession }
        : {}),
      ...(appConfig.persistenceEnabled
        ? { durabilityStore: openDurabilityStore(appConfig) }
        : {}),
    };
  },
  createCheckpointer: async (context) => {
    if (!context.config.persistenceEnabled) {
      return new MemorySaver();
    }

    const store = context.adapters.durabilityStore;
    if (!store) {
      throw new Error("Persistence is enabled but durabilityStore adapter is missing.");
    }

    return store.getCheckpointer();
  },
  seedAgents: async (repository, { adapters }) =>
    prepareRuntimeAgents(await repository.loadAgents(), {
      supabaseAvailable:
        adapters.supabaseWriteSession !== undefined || adapters.supabaseReadSession !== undefined,
    }),
  buildSkillCatalog: buildPersonalSkillCatalog,
  buildRuntimeExecution: (_agents, skillCatalog, ctx) => {
    const cacheManager = createGeminiContextCacheManager(
      ctx.config.googleApiKey,
      isGeminiContextCacheEnabled(),
    );

    return buildAppRuntimeExecution({
      skillCatalog,
      capabilityCatalog: ctx.capabilityCatalog,
      contextCache: {
        cacheManager,
        apiKey: ctx.config.googleApiKey,
        resolveRuntimeModelName: (definition) =>
          resolveBuiltinModelName(ctx.config, resolveAgentModelKey(definition)),
        supervisorModelName: ctx.config.supervisorModel,
      },
    });
  },
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
      supabaseReadSession: context.adapters.supabaseReadSession,
      supabaseWriteSession: context.adapters.supabaseWriteSession,
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
