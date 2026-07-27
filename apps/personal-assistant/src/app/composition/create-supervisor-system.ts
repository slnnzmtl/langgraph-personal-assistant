import type { AppConfig } from "../../config.js";
import { GeminiConnector } from "../../connectors/llm-connector.js";
import { createCronJobRepositoryForConfig } from "../../cron/cron-job-repository.js";
import {
  bootstrapSupervisorSystem,
  buildSkillModuleOwnerPattern,
  deriveRuntimeAgentGraphFingerprint,
  type CompiledSupervisorGraph,
} from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";
import {
  buildPersonalSupervisorPack,
  type SupervisorSystemOptions,
} from "./personal-pack.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";

type PersonalAdapters = { supabaseSession?: CapabilityDeps["supabaseSession"] };

export type SupervisorSystemContext = {
  config: AppConfig;
  getGraph(): CompiledSupervisorGraph;
  recompile(): Promise<boolean>;
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
  const pack = buildPersonalSupervisorPack({
    config,
    options,
    supervisorLlm: supervisorConnector,
  });

  let bootstrap = await bootstrapSupervisorSystem(pack);
  let fingerprint = deriveRuntimeAgentGraphFingerprint(bootstrap.runtimeAgents);

  const recompile = async (): Promise<boolean> => {
    const runtimeAgentRepository = bootstrap.capabilityDeps.runtimeAgentRepository;
    if (!runtimeAgentRepository) {
      throw new Error("Runtime agent repository is not configured.");
    }

    const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, {
      adapters: bootstrap.adapters,
    });
    const nextFingerprint = deriveRuntimeAgentGraphFingerprint(runtimeAgents);
    if (nextFingerprint === fingerprint) {
      return false;
    }

    const previousSession = bootstrap.adapters.supabaseSession;
    if (previousSession?.close) {
      await previousSession.close().catch(() => undefined);
    }

    bootstrap = await bootstrapSupervisorSystem(pack);
    fingerprint = deriveRuntimeAgentGraphFingerprint(bootstrap.runtimeAgents);
    console.log(`[RuntimeAgents] Recompiled supervisor graph (${fingerprint})`);
    return true;
  };

  return {
    config: bootstrap.config,
    getGraph: () => bootstrap.graph,
    recompile,
    cronJobRepository: bootstrap.cronJobRepository as ReturnType<typeof createCronJobRepositoryForConfig>,
    cronTargetAgentIds: bootstrap.cronTargetAgentIds,
    supervisorConnector,
    skillModulePattern: buildSkillModuleOwnerPattern(bootstrap.skillCatalog.listModules()),
    ...(bootstrap.capabilityDeps.supabaseSession
      ? { supabaseSession: bootstrap.capabilityDeps.supabaseSession }
      : {}),
  };
};
