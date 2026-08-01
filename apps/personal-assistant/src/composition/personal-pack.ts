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
import { loadSupervisorSystemPrompt, loadSystemPromptByKey } from "../prompts/load.js";
import { createDataAgentPromptStore } from "../prompts/prompt-store.js";
import type { PersonalCapabilityDeps } from "../runtime-agents/personal-capability-deps.js";
import type { SendFile } from "../runtime-agents/obsidian/tools.js";
import { buildModelRegistry } from "./model-registry.js";
import { buildAppRuntimeExecution } from "./runtime-execution.js";
import { createPersonalRuntimeAgentPolicy } from "./personal-runtime-policy.js";
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
import { buildPersonalCapabilityProviders } from "./personal-capability-providers.js";

export type { BuildPersonalCapabilityProvidersInput } from "./personal-capability-providers.js";
export { buildPersonalCapabilityProviders } from "./personal-capability-providers.js";

const personalDefaultContentSeeder = createDefaultContentSeeder({
  promptsDir: path.resolve(process.cwd(), "data/prompts"),
  skillsDir: path.resolve(process.cwd(), "data/skills"),
  logger: (message) => getLogger().info(message),
});

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  /** Bound send operation from the concrete Telegram sender (chat ID stays on that instance). */
  sendFile?: SendFile;
  /** Bot entrypoints use writer; scheduler uses reader. Default writer. */
  dataWriteRole?: "writer" | "reader";
};

/** System-only capability deps (product clients are closed over in buildCapabilityProviders). */
export type BuildPersonalCapabilityDepsInput = {
  cronTargetAgentIds: readonly string[];
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
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

export const buildPersonalCapabilityDeps = (
  input: BuildPersonalCapabilityDepsInput,
): PersonalCapabilityDeps => ({
  cronTargetAgentIds: input.cronTargetAgentIds,
  capabilityCatalog: input.capabilityCatalog,
  skillCatalog: input.skillCatalog,
  ...(input.cronJobRepository ? { cronJobRepository: input.cronJobRepository } : {}),
  ...(input.runtimeAgentRepository
    ? { runtimeAgentRepository: input.runtimeAgentRepository }
    : {}),
  ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
  ...(input.loadPromptByKey ? { loadPromptByKey: input.loadPromptByKey } : {}),
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
  const vaultRoot = config.obsidianVaultPath || undefined;

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
    createRuntimeAgentPolicy: (shellHooks, policyOptions) =>
      createPersonalRuntimeAgentPolicy(shellHooks, policyOptions, vaultRoot),
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
  buildCapabilityProviders: (ctx) =>
    buildPersonalCapabilityProviders({
      config: ctx.config,
      adapters: ctx.adapters,
      ...(options.sendFile !== undefined ? { sendFile: options.sendFile } : {}),
    }),
  supervisorLlm,
  loadSupervisorPrompt: loadSupervisorSystemPrompt,
  systemAgent: {
    modelKey: "configuration",
  },
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
  buildCapabilityDeps: (context) =>
    buildPersonalCapabilityDeps({
      cronTargetAgentIds: context.cronTargetAgentIds,
      cronJobRepository: context.cronJobRepository as CronJobRepository,
      runtimeAgentRepository: context.runtimeAgentRepository,
      capabilityCatalog: context.capabilityCatalog,
      skillCatalog: context.skillCatalog,
      ...(options.runtimeCron !== undefined ? { runtimeCron: options.runtimeCron } : {}),
      loadPromptByKey: loadSystemPromptByKey,
    }),
  buildGraphHooks: (context) => ({
    promptLogging: createFilePromptLogger({
      enabled: () => process.env.ENABLE_PROMPT_LOGS !== "false",
    }),
    ...buildPersonalCronGraphHooks(context.cronTargetAgentIds),
  }),
});
