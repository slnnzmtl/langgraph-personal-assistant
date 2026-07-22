import type { AppConfig } from "../../config.js";
import {
  applyLocalModuleAvailability,
  buildDefaultRuntimeAgents,
  CONFIGURATOR_AGENT_ID,
  ensureBuiltinRuntimeAgents,
} from "./bootstrap-agents.js";
import { setupSupabaseSession } from "../../services/supabase.js";
import { buildModelRegistry } from "../model-registry.js";
import {
  createDefaultCapabilityCatalog,
  createCapabilityDeps,
} from "../../runtime-agents/builtin-capabilities.js";
import { createFilesystemSkillCatalog } from "../../integrations/skills/filesystem-skill-catalog.js";
import { createAppExecutionKit } from "../register-defaults.js";
import {
  bootstrapSupervisorSystem,
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
  deriveSkillModules,
  type SupervisorSystemContext,
  type SupervisorSystemOptions,
} from "./bootstrap-supervisor-system.js";

export {
  deriveModelKeys,
  deriveExecutors,
  deriveSkillModules,
  deriveCronTargetAgentIds,
  type SupervisorSystemOptions,
  type SupervisorSystemContext,
  type SupervisorPackBootstrap,
  type SupervisorBootstrapContext,
} from "./bootstrap-supervisor-system.js";

export const createSupervisorSystem = async (
  config: AppConfig,
  options: SupervisorSystemOptions = {},
): Promise<SupervisorSystemContext> => {
  const capabilityCatalog = createDefaultCapabilityCatalog();

  return bootstrapSupervisorSystem({
    config,
    capabilityCatalog,
    options,
    setupAdapters: async (appConfig) => ({
      supabaseSession: await setupSupabaseSession(appConfig),
    }),
    seedAgents: async (repository, { supabaseAvailable }) =>
      applyLocalModuleAvailability(await ensureBuiltinRuntimeAgents(repository), {
        supabaseAvailable,
      }),
    buildSkillCatalog: (agents) =>
      createFilesystemSkillCatalog({
        approvedModules: [CONFIGURATOR_AGENT_ID, ...deriveSkillModules(agents)],
      }),
    buildPolicyRegistry: (agents, skillCatalog) =>
      createAppExecutionKit(deriveExecutors(agents), { skillCatalog }),
    buildModels: (appConfig, agents) =>
      buildModelRegistry(appConfig, deriveModelKeys(agents, "generic")),
    buildCapabilityDeps: (context) =>
      createCapabilityDeps(context.config.obsidianVaultPath, {
        cronTargetAgentIds: context.cronTargetAgentIds,
        cronJobRepository: context.cronJobRepository,
        runtimeAgentRepository: context.runtimeAgentRepository,
        capabilityCatalog: context.capabilityCatalog,
        skillCatalog: context.skillCatalog,
        ...(context.options.fileSender ? { fileSender: context.options.fileSender } : {}),
        ...(context.supabaseSession ? { supabaseSession: context.supabaseSession } : {}),
        ...(context.options.runtimeCron ? { runtimeCron: context.options.runtimeCron } : {}),
      }),
  });
};

export { buildDefaultRuntimeAgents, CONFIGURATOR_AGENT_ID };
