import type { AppConfig } from "../../config.js";
import { createWorkflowGraph } from "../../agent.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import type { RuntimeCronService } from "../../cron/types.js";
import { createRuntimeAgentRepositoryForConfig } from "../../core/agents/repository.js";
import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentModelKey } from "../../core/types/agent.js";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import {
  applyLocalModuleAvailability,
  buildDefaultRuntimeAgents,
  buildSkillModuleOwnerPattern,
  CONFIGURATOR_AGENT_ID,
  ensureBuiltinRuntimeAgents,
} from "./bootstrap-agents.js";
import { setupSupabaseSession } from "../../services/supabase.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { buildModelRegistry } from "../model-registry.js";
import {
  createDefaultCapabilityCatalog,
  createRuntimeToolBundleDeps,
} from "../../runtime-agents/tool-bundles.js";
import { createFilesystemSkillCatalog } from "../../integrations/skills/filesystem-skill-catalog.js";
import { createAppExecutionKit } from "../register-defaults.js";

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

export const createSupervisorSystem = async (
  config: AppConfig,
  options: SupervisorSystemOptions = {},
): Promise<SupervisorSystemContext> => {
  const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
  const supabaseSession = await setupSupabaseSession(config);
  const runtimeAgentRepository = createRuntimeAgentRepositoryForConfig(config.runtimeAgentsFilePath);

  const runtimeAgents = applyLocalModuleAvailability(
    await ensureBuiltinRuntimeAgents(runtimeAgentRepository),
    { supabaseAvailable: supabaseSession !== undefined },
  );

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const cronJobRepository = createCronJobRepositoryForConfig(config.cronJobsFilePath, cronTargetAgentIds);
  const capabilityCatalog = createDefaultCapabilityCatalog();
  const skillCatalog = createFilesystemSkillCatalog({
    approvedModules: [CONFIGURATOR_AGENT_ID, ...deriveSkillModules(runtimeAgents)],
  });

  const bundleDeps = createRuntimeToolBundleDeps(config.obsidianVaultPath, {
    cronTargetAgentIds,
    cronJobRepository,
    runtimeAgentRepository,
    capabilityCatalog,
    skillCatalog,
    ...(options.fileSender ? { fileSender: options.fileSender } : {}),
    ...(supabaseSession ? { supabaseSession } : {}),
  });

  const defaultModelKey = "generic";
  const models = buildModelRegistry(config, deriveModelKeys(runtimeAgents, defaultModelKey));
  const { loadPromptByKey, policyRegistry } = createAppExecutionKit(deriveExecutors(runtimeAgents), {
    skillCatalog,
  });

  const graph = createWorkflowGraph({
    supervisorLlm: supervisorConnector,
    models,
    runtimeAgents,
    defaultModelKey,
    cronTargetAgentIds,
    cronJobRepository,
    runtimeAgentRepository,
    loadPromptByKey,
    policyRegistry,
    bundleDeps,
    messageHistoryMaxTokens: config.messageHistoryMaxTokens,
    ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
  });

  return {
    config,
    graph,
    cronJobRepository,
    cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(skillCatalog.listModules()),
    ...(supabaseSession ? { supabaseSession } : {}),
  };
};

export { buildDefaultRuntimeAgents, CONFIGURATOR_AGENT_ID };
