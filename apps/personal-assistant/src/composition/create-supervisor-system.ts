import type { AppConfig } from "../config.js";
import { GeminiConnector } from "@personal-assistant/llm-gemini";
import {
  createSupervisorRuntime,
  type CompiledSupervisorGraph,
  type CronJobRepository,
} from "@personal-assistant/supervisor-framework";
import type { PersonalCapabilityDeps } from "../runtime-agents/capabilities.js";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import type { DurabilityStore } from "../persistence/durability-store.js";
import {
  buildPersonalSupervisorPack,
  type SupervisorSystemOptions,
} from "./personal-pack.js";

export type { SupervisorSystemOptions } from "./personal-pack.js";

type PersonalAdapters = {
  supabaseReadSession?: SupabaseMcpSession;
  supabaseWriteSession?: SupabaseMcpSession;
  durabilityStore?: DurabilityStore;
};

const closeSupabaseSessions = async (adapters: PersonalAdapters): Promise<void> => {
  await Promise.all([
    adapters.supabaseReadSession?.close?.().catch(() => undefined),
    adapters.supabaseWriteSession?.close?.().catch(() => undefined),
  ]);
};

const closeAdapters = async (adapters: PersonalAdapters): Promise<void> => {
  await closeSupabaseSessions(adapters);
  adapters.durabilityStore?.close();
};

export type PersonalSupervisorSystem = {
  config: AppConfig;
  getGraph(): CompiledSupervisorGraph;
  recompile(): Promise<boolean>;
  getCronJobRepository(): CronJobRepository;
  getCronTargetAgentIds(): readonly string[];
  getDurabilityStore(): DurabilityStore | undefined;
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
      onBeforeRecompile: closeAdapters,
      onShutdownAdapters: closeAdapters,
    },
  );

  return {
    config: runtime.getBootstrap().config,
    getGraph: () => runtime.getGraph(),
    recompile: () => runtime.recompile(),
    getCronJobRepository: () => runtime.getCronJobRepository(),
    getCronTargetAgentIds: () => runtime.getCronTargetAgentIds(),
    getDurabilityStore: () => runtime.getBootstrap().adapters.durabilityStore,
    supervisorConnector,
    shutdownAdapters: () => runtime.shutdownAdapters(),
  };
};
