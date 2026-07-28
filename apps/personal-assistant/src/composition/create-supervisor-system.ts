import type { AppConfig } from "../config.js";
import { GeminiConnector } from "../models/gemini-connector.js";
import {
  createSupervisorRuntime,
  type CompiledSupervisorGraph,
  type CronJobRepository,
} from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../runtime-agents/capabilities.js";
import {
  buildPersonalSupervisorPack,
  type SupervisorSystemOptions,
} from "./personal-pack.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";

type PersonalAdapters = { supabaseSession?: PersonalCapabilityDeps["supabaseSession"] };

const closeSupabaseSession = async (adapters: PersonalAdapters): Promise<void> => {
  if (adapters.supabaseSession?.close) {
    await adapters.supabaseSession.close().catch(() => undefined);
  }
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
  const runtime = await createSupervisorRuntime(
    buildPersonalSupervisorPack({
      config,
      options,
      supervisorLlm: supervisorConnector,
    }),
    {
      onBeforeRecompile: closeSupabaseSession,
      onShutdownAdapters: closeSupabaseSession,
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
