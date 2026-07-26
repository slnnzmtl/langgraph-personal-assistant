import type { AppConfig } from "../../config.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import {
  buildSkillModuleOwnerPattern,
  type CompiledSupervisorGraph,
} from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import {
  type SupervisorSystemOptions,
} from "./personal-pack.js";
import { createSupervisorGraphRef, type SupervisorGraphRef } from "./supervisor-graph-ref.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";
export type { SupervisorGraphRef } from "./supervisor-graph-ref.js";

export type SupervisorSystemContext = {
  config: AppConfig;
  graph: CompiledSupervisorGraph;
  graphRef: SupervisorGraphRef;
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
  const { graphRef, bootstrap: result } = await createSupervisorGraphRef(
    config,
    options,
    supervisorConnector,
  );

  return {
    config: result.config,
    graph: graphRef.getGraph(),
    graphRef,
    cronJobRepository: result.cronJobRepository as ReturnType<typeof createCronJobRepositoryForConfig>,
    cronTargetAgentIds: result.cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(result.skillCatalog.listModules()),
    ...(result.capabilityDeps.supabaseSession
      ? { supabaseSession: result.capabilityDeps.supabaseSession }
      : {}),
  };
};
