import { MemorySaver } from "@langchain/langgraph";

import { bootstrapSupervisorSystem } from "./bootstrap-supervisor-system.js";
import type { CronTargetAgentIdsSource } from "./cron/cron-job-repository.js";
import { createNoopCronJobRepository } from "./defaults/noop-cron-job-repository.js";
import { deriveRuntimeAgentGraphFingerprint } from "./derive-agents.js";
import type {
  CompiledSupervisorGraph,
  CronJobRepository,
  SupervisorPackBootstrap,
  SupervisorPaths,
  SupervisorSystemContext,
} from "./types.js";

export type SupervisorRuntimeOptions<TAdapters extends Record<string, unknown>> = {
  /** Close adapter sessions before rebootstrap (e.g. MCP transports). */
  onBeforeRecompile?: (adapters: TAdapters) => Promise<void> | void;
  /** Release adapter resources on process shutdown. */
  onShutdownAdapters?: (adapters: TAdapters) => Promise<void> | void;
  /** Called after a graph recompile succeeds. */
  onRecompiled?: (fingerprint: string) => void;
};

export type SupervisorRuntime<
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
> = {
  getGraph(): CompiledSupervisorGraph;
  getBootstrap(): SupervisorSystemContext<TConfig, TDeps, TAdapters>;
  recompile(): Promise<boolean>;
  getCronJobRepository(): CronJobRepository;
  getCronTargetAgentIds(): readonly string[];
  shutdownAdapters(): Promise<void>;
};

export const createSupervisorRuntime = async <
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
>(
  pack: SupervisorPackBootstrap<TConfig, TDeps, TAdapters>,
  options: SupervisorRuntimeOptions<TAdapters> = {},
): Promise<SupervisorRuntime<TConfig, TDeps, TAdapters>> => {
  const checkpointer = new MemorySaver();
  const cronTargetAgentIdsRef = { ids: [] as readonly string[] };
  let stableCronJobRepository: CronJobRepository | undefined;

  const resolveCronJobRepository = (cronJobsFilePath: string): CronJobRepository => {
    if (stableCronJobRepository) {
      return stableCronJobRepository;
    }

    const targetIdsSource: CronTargetAgentIdsSource = () => cronTargetAgentIdsRef.ids;
    stableCronJobRepository = pack.createCronJobRepository
      ? pack.createCronJobRepository(cronJobsFilePath, targetIdsSource)
      : createNoopCronJobRepository();

    return stableCronJobRepository;
  };

  const runtimePack: SupervisorPackBootstrap<TConfig, TDeps, TAdapters> = {
    ...pack,
    createCronJobRepository: (cronJobsFilePath) => resolveCronJobRepository(cronJobsFilePath),
    buildGraphHooks: (context) => ({
      ...(pack.buildGraphHooks?.(context) ?? pack.graphHooks ?? {}),
      checkpointer,
    }),
  };

  let bootstrap = await bootstrapSupervisorSystem(runtimePack);
  cronTargetAgentIdsRef.ids = bootstrap.cronTargetAgentIds;
  let fingerprint = deriveRuntimeAgentGraphFingerprint(bootstrap.runtimeAgents);
  let recompileChain: Promise<boolean> = Promise.resolve(false);

  const logRecompiled =
    options.onRecompiled
    ?? ((nextFingerprint: string) => {
      console.log(`[RuntimeAgents] Recompiled supervisor graph (${nextFingerprint})`);
    });

  const doRecompile = async (): Promise<boolean> => {
    const runtimeAgentRepository = bootstrap.runtimeAgentRepository;

    const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, {
      adapters: bootstrap.adapters,
    });
    const nextFingerprint = deriveRuntimeAgentGraphFingerprint(runtimeAgents);
    if (nextFingerprint === fingerprint) {
      return false;
    }

    await options.onBeforeRecompile?.(bootstrap.adapters);

    bootstrap = await bootstrapSupervisorSystem(runtimePack, {
      preparedRuntimeAgents: runtimeAgents,
    });
    cronTargetAgentIdsRef.ids = bootstrap.cronTargetAgentIds;
    fingerprint = nextFingerprint;
    logRecompiled(fingerprint);
    return true;
  };

  const recompile = (): Promise<boolean> => {
    const next = recompileChain.then(() => doRecompile());
    recompileChain = next.catch(() => false);
    return next;
  };

  return {
    getGraph: () => bootstrap.graph,
    getBootstrap: () => bootstrap,
    recompile,
    getCronJobRepository: () => stableCronJobRepository ?? bootstrap.cronJobRepository,
    getCronTargetAgentIds: () => bootstrap.cronTargetAgentIds,
    shutdownAdapters: async () => {
      await options.onShutdownAdapters?.(bootstrap.adapters);
    },
  };
};
