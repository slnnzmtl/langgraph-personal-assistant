import type { AppConfig } from "../config.js";
import { GeminiConnector } from "../models/gemini-connector.js";
import {
  createSupervisorRuntime,
  type CompiledSupervisorGraph,
  type CronJobRepository,
} from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../runtime-agents/capabilities.js";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import {
  buildPersonalSupervisorPack,
  type SupervisorSystemOptions,
} from "./personal-pack.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";

type PersonalAdapters = {
  supabaseReadSession?: SupabaseMcpSession;
  supabaseWriteSession?: SupabaseMcpSession;
};

const closeSupabaseSessions = async (adapters: PersonalAdapters): Promise<void> => {
  await Promise.all([
    adapters.supabaseReadSession?.close?.().catch(() => undefined),
    adapters.supabaseWriteSession?.close?.().catch(() => undefined),
  ]);
};

export type PersonalSupervisorSystem = {
  config: AppConfig;
  getGraph(): CompiledSupervisorGraph;
  recompile(): Promise<boolean>;
  getCronJobRepository(): CronJobRepository;
  getCronTargetAgentIds(): readonly string[];
  supervisorConnector: GeminiConnector;
  shutdownAdapters(): Promise<void>;
};

export const createSupervisorSystem = async (
  config: AppConfig,
  options: SupervisorSystemOptions = {},
): Promise<PersonalSupervisorSystem> => {
  const supervisorConnector = new GeminiConnector(config.googleApiKey, config.supervisorModel);
  const allowDataWrites = (options.dataWriteRole ?? "writer") === "writer";
  const runtime = await createSupervisorRuntime(
    buildPersonalSupervisorPack({
      config: { ...config, allowDataWrites },
      options,
      supervisorLlm: supervisorConnector,
    }),
    {
      onBeforeRecompile: closeSupabaseSessions,
      onShutdownAdapters: closeSupabaseSessions,
    },
  );

  return {
    config: runtime.getBootstrap().config,
    getGraph: () => runtime.getGraph(),
    recompile: () => runtime.recompile(),
    getCronJobRepository: () => runtime.getCronJobRepository(),
    getCronTargetAgentIds: () => runtime.getCronTargetAgentIds(),
    supervisorConnector,
    shutdownAdapters: () => runtime.shutdownAdapters(),
  };
};
