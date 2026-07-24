import type { AppConfig } from "../../config.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import type { RuntimeCronService } from "../../cron/types.js";
import { createCronTriggerResolver, SUPERVISE_CRON_ROUTE } from "../../cron-triggers.js";
import {
  bootstrapSupervisorSystem,
  defaultReplyUxConfig,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
  type CompiledSupervisorGraph,
  type SupervisorBootstrapContext,
  type SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { loadSupervisorSystemPrompt } from "../../prompts/load-system-prompt.js";
import {
  createDefaultCapabilityCatalog,
  createCapabilityDeps,
  type CapabilityDeps,
} from "../../runtime-agents/builtin-capabilities.js";
import { setupSupabaseSession } from "../../services/supabase.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { createSkillCatalog } from "../../prompts/skill-catalog.js";
import { buildModelRegistry } from "../model-registry.js";
import { createAppExecutionKit } from "../register-defaults.js";
import {
  applyLocalModuleAvailability,
  buildDefaultRuntimeAgents,
  buildSkillModuleOwnerPattern,
  CONFIGURATOR_AGENT_ID,
  ensureBuiltinRuntimeAgents,
} from "./bootstrap-agents.js";

export {
  bootstrapSupervisorSystem,
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
} from "@personal-assistant/supervisor-framework";

export type {
  CompiledSupervisorGraph,
  SupervisorBootstrapContext,
  SupervisorPackBootstrap,
} from "@personal-assistant/supervisor-framework";

export type SupervisorSystemOptions = {
  runtimeCron?: RuntimeCronService;
  fileSender?: IFileSender;
};

export type PersonalSupervisorBootstrapContext = SupervisorBootstrapContext<
  AppConfig,
  CapabilityDeps,
  { supabaseSession?: SupabaseMcpSession }
> & {
  options: SupervisorSystemOptions;
};

export type SupervisorSystemContext = {
  config: AppConfig;
  graph: CompiledSupervisorGraph;
  cronJobRepository: ReturnType<typeof createCronJobRepositoryForConfig>;
  cronTargetAgentIds: readonly string[];
  supervisorConnector: GeminiConnector;
  supabaseSession?: SupabaseMcpSession;
  skillModulePattern: RegExp;
};

type PersonalAdapters = { supabaseSession?: SupabaseMcpSession | undefined };

export const createSupervisorSystem = async (
  config: AppConfig,
  options: SupervisorSystemOptions = {},
): Promise<SupervisorSystemContext> => {
  const capabilityCatalog = createDefaultCapabilityCatalog();
  const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
  let supabaseSession: SupabaseMcpSession | undefined;

  const pack: SupervisorPackBootstrap<AppConfig, CapabilityDeps, PersonalAdapters> = {
    config,
    capabilityCatalog,
    supervisorLlm: supervisorConnector,
    loadSupervisorPrompt: loadSupervisorSystemPrompt,
    createCronJobRepository: (cronJobsFilePath, targetAgentIds) =>
      createCronJobRepositoryForConfig(cronJobsFilePath, targetAgentIds),
    setupAdapters: async (appConfig) => {
      const adapters = {
        supabaseSession: await setupSupabaseSession(appConfig),
      };
      supabaseSession = adapters.supabaseSession;
      return adapters;
    },
    seedAgents: async (repository, { adapters }) =>
      applyLocalModuleAvailability(await ensureBuiltinRuntimeAgents(repository), {
        supabaseAvailable: adapters.supabaseSession !== undefined,
      }),
    buildSkillCatalog: (agents) =>
      createSkillCatalog({
        approvedModules: [CONFIGURATOR_AGENT_ID, ...deriveSkillModules(agents)],
      }),
    buildPolicyRegistry: (agents, skillCatalog) =>
      createAppExecutionKit(deriveExecutors(agents), { skillCatalog, capabilityCatalog }),
    buildModels: (appConfig, agents) =>
      buildModelRegistry(appConfig, deriveModelKeys(agents, "generic")),
    buildCapabilityDeps: (context) =>
      createCapabilityDeps(context.config.obsidianVaultPath, {
        cronTargetAgentIds: context.cronTargetAgentIds,
        cronJobRepository: context.cronJobRepository as ReturnType<typeof createCronJobRepositoryForConfig>,
        runtimeAgentRepository: context.runtimeAgentRepository,
        capabilityCatalog: context.capabilityCatalog,
        skillCatalog: context.skillCatalog,
        ...(options.fileSender ? { fileSender: options.fileSender } : {}),
        ...(context.adapters.supabaseSession ? { supabaseSession: context.adapters.supabaseSession } : {}),
        ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
      }),
    buildGraphHooks: (context) => {
      const cronTriggerResolver = createCronTriggerResolver(context.cronTargetAgentIds);

      return {
        replyUx: defaultReplyUxConfig,
        promptLogging: logSystemPromptInvocation,
        messageHistoryMaxTokens: config.messageHistoryMaxTokens,
        cronTriggerResolver: {
          resolveCronTriggerRoute: (message) =>
            cronTriggerResolver.resolveCronTriggerRoute(message) ?? undefined,
          superviseCronRoute: SUPERVISE_CRON_ROUTE,
        },
      };
    },
  };

  const result = await bootstrapSupervisorSystem(pack);

  return {
    config: result.config,
    graph: result.graph,
    cronJobRepository: result.cronJobRepository as ReturnType<typeof createCronJobRepositoryForConfig>,
    cronTargetAgentIds: result.cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(result.skillCatalog.listModules()),
    ...(supabaseSession ? { supabaseSession } : {}),
  };
};

export { buildDefaultRuntimeAgents, CONFIGURATOR_AGENT_ID };
