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
import { loadSupervisorSystemPrompt, loadSystemPromptByKey } from "../prompts/load.js";
import { createDataAgentPromptStore } from "../prompts/prompt-store.js";
import type { PersonalCapabilityDeps } from "../runtime-agents/system-capability-deps.js";
import { createObsidianVault } from "../integrations/obsidian.js";
import { createFetchWiseTransactions } from "../integrations/wise.js";
import {
  FINANCE_DOMAIN_CAPABILITY_ID,
  FINANCE_DOMAIN_READ_CAPABILITY_ID,
  createFinanceDomainTools,
} from "../runtime-agents/finance/tools.js";
import {
  OBSIDIAN_VAULT_CAPABILITY_ID,
  createObsidianVaultTools,
  type SendFile,
} from "../runtime-agents/obsidian/tools.js";
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

/** System-only capability deps (domain clients are closed over in buildCapabilityProviders). */
export type BuildPersonalCapabilityDepsInput = {
  cronTargetAgentIds: readonly string[];
  capabilityCatalog: CapabilityCatalog;
  skillCatalog: SkillCatalog;
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  loadPromptByKey?: PersonalCapabilityDeps["loadPromptByKey"];
};

export type BuildPersonalCapabilityProvidersInput = {
  config: AppConfig;
  adapters: PersonalAdapters;
  sendFile?: SendFile;
};

/** Product capability providers closed over fresh adapters/config (soft-recompile safe). */
export const buildPersonalCapabilityProviders = ({
  config,
  adapters,
  sendFile,
}: BuildPersonalCapabilityProvidersInput): CapabilityProvider<Record<string, unknown>>[] => {
  const vault = config.obsidianVaultPath
    ? createObsidianVault(config.obsidianVaultPath)
    : undefined;
  const writeSession = adapters.supabaseWriteSession;
  const readSession = adapters.supabaseReadSession;
  const fetchWise = createFetchWiseTransactions(config);

  return [
    {
      descriptor: {
        id: OBSIDIAN_VAULT_CAPABILITY_ID,
        description: "Read, write, search, and send files from the Obsidian vault.",
        grantable: true,
      },
      isAvailable: () => vault !== undefined,
      resolveTools: () => {
        if (!vault) {
          throw new Error("obsidian-vault capability requires a configured Obsidian vault.");
        }

        return createObsidianVaultTools(vault, sendFile);
      },
    },
    {
      descriptor: {
        id: FINANCE_DOMAIN_CAPABILITY_ID,
        description: "Execute SQL, fetch Wise transactions, and load expense categories.",
        grantable: false,
        reservedForAgentIds: ["finance"],
      },
      isAvailable: () => writeSession !== undefined,
      resolveTools: () => {
        if (!writeSession) {
          throw new Error("finance-domain capability requires a configured Supabase write session.");
        }

        return createFinanceDomainTools(
          (sql) => writeSession.executeSql(sql),
          {
            writeAccess: true,
            ...(fetchWise ? { fetchWise } : {}),
          },
        );
      },
    },
    {
      descriptor: {
        id: FINANCE_DOMAIN_READ_CAPABILITY_ID,
        description: "Query the expense ledger with read-only SQL and category lookup.",
        grantable: true,
      },
      isAvailable: () => readSession !== undefined,
      resolveTools: () => {
        if (!readSession) {
          throw new Error(
            "finance-domain-read capability requires a configured Supabase read session.",
          );
        }

        return createFinanceDomainTools(
          (sql) => readSession.executeSql(sql),
          { writeAccess: false },
        );
      },
    },
  ];
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
