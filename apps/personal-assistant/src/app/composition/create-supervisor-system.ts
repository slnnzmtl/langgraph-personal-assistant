import type { AppConfig } from "../../config.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import {
  bootstrapSupervisorSystem,
  buildSkillModuleOwnerPattern,
  type CompiledSupervisorGraph,
} from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import {
  buildPersonalSupervisorPack,
  type SupervisorSystemOptions,
} from "./personal-pack.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";

export type SupervisorSystemContext = {
  config: AppConfig;
  graph: CompiledSupervisorGraph;
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

  const result = await bootstrapSupervisorSystem(
    buildPersonalSupervisorPack({
      config,
      options,
      supervisorLlm: supervisorConnector,
    }),
  );

  return {
    config: result.config,
    graph: result.graph,
    cronJobRepository: result.cronJobRepository as ReturnType<typeof createCronJobRepositoryForConfig>,
    cronTargetAgentIds: result.cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(result.skillCatalog.listModules()),
    ...(result.capabilityDeps.supabaseSession
      ? { supabaseSession: result.capabilityDeps.supabaseSession }
      : {}),
  };
};
