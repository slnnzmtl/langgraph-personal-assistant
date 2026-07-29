import path from "node:path";

import { createCapabilityCatalog } from "../capabilities/index.js";
import { validatePersistedAgentCapabilities } from "../capabilities/validate-persisted-agents.js";
import { createAssistant } from "../core/create-assistant.js";
import { createRuntimeAgentRepository } from "../core/agents/repository.js";
import {
  createReadOnlyCronJobRepository,
  createReadOnlyRuntimeAgentRepository,
} from "../core/persistence/read-only-repositories.js";
import { DEFAULT_MODEL_KEY } from "../core/types/agent.js";
import { defaultReplyUxConfig } from "../core/supervisor/reply-ux.js";
import { createEmptySkillCatalog } from "./defaults/empty-skill-catalog.js";
import { createNoopCronJobRepository } from "./defaults/noop-cron-job-repository.js";
import { deriveCronTargetAgentIds } from "./derive-agents.js";
import {
  createSystemConfigCapabilityProviders,
  type SystemAgentRepository,
  wrapRepositoryWithSystemAgent,
} from "./system-agent/index.js";
import type { SystemAgentOptions } from "./system-agent/definition.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import type {
  SupervisorPackBootstrap,
  SupervisorPaths,
  SupervisorSystemContext,
} from "./types.js";

export type BootstrapSupervisorSystemOptions = {
  /** Reuse agents already prepared during a soft recompile fingerprint pass. */
  preparedRuntimeAgents?: RuntimeAgentDefinition[];
};

export const bootstrapSupervisorSystem = async <
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
>(
  pack: SupervisorPackBootstrap<TConfig, TDeps, TAdapters>,
  options: BootstrapSupervisorSystemOptions = {},
): Promise<SupervisorSystemContext<TConfig, TDeps, TAdapters>> => {
  const adapters = pack.setupAdapters ? await pack.setupAdapters(pack.config) : ({} as TAdapters);
  const systemAgentEnabled = pack.systemAgent !== undefined && pack.systemAgent !== false;
  const allowDataWrites = pack.config.allowDataWrites !== false;

  if (allowDataWrites) {
    await pack.initializeDefaults?.({
      config: pack.config,
      systemAgentEnabled,
    });
  }

  const baseRuntimeAgentRepository =
    pack.createRuntimeAgentRepository?.(pack.config) ??
    createRuntimeAgentRepository(
      process.cwd(),
      path.relative(process.cwd(), pack.config.runtimeAgentsFilePath),
    );

  let runtimeAgentRepository = systemAgentEnabled
    ? wrapRepositoryWithSystemAgent(baseRuntimeAgentRepository, pack.systemAgent as SystemAgentOptions)
    : baseRuntimeAgentRepository;

  if (systemAgentEnabled && allowDataWrites) {
    await (runtimeAgentRepository as SystemAgentRepository).purgeLegacySystemAgent();
  }

  if (!allowDataWrites) {
    runtimeAgentRepository = createReadOnlyRuntimeAgentRepository(runtimeAgentRepository);
  }

  const runtimeAgents =
    options.preparedRuntimeAgents
    ?? await pack.seedAgents(runtimeAgentRepository, { adapters });

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const baseCronJobRepository =
    pack.createCronJobRepository?.(pack.config.cronJobsFilePath, cronTargetAgentIds) ??
    createNoopCronJobRepository();
  const cronJobRepository = !allowDataWrites
    ? createReadOnlyCronJobRepository(baseCronJobRepository)
    : baseCronJobRepository;
  const skillCatalog = pack.buildSkillCatalog?.(runtimeAgents) ?? createEmptySkillCatalog();

  const capabilityCatalog = pack.capabilityProviders
    ? createCapabilityCatalog([
        ...pack.capabilityProviders,
        ...(systemAgentEnabled ? createSystemConfigCapabilityProviders() : []),
      ])
    : pack.capabilityCatalog;

  if (!capabilityCatalog) {
    throw new Error("SupervisorPackBootstrap requires capabilityProviders or capabilityCatalog.");
  }

  const bootstrapContext = {
    config: pack.config,
    runtimeAgentRepository,
    runtimeAgents,
    cronTargetAgentIds,
    cronJobRepository,
    capabilityCatalog,
    skillCatalog,
    adapters,
  };

  const capabilityDeps = pack.buildCapabilityDeps(bootstrapContext);

  if (pack.validatePersistedAgents) {
    pack.validatePersistedAgents(runtimeAgents, capabilityCatalog, capabilityDeps);
  } else {
    validatePersistedAgentCapabilities(
      runtimeAgents,
      capabilityCatalog,
      capabilityDeps,
      pack.reservedCapabilitiesByAgentId
        ? { reservedCapabilitiesByAgentId: pack.reservedCapabilitiesByAgentId }
        : {},
    );
  }

  const defaultModelKey = DEFAULT_MODEL_KEY;
  const models = pack.buildModels(pack.config, runtimeAgents);
  const {
    loadPromptByKey,
    runtimeAgentPolicy,
    buildSupervisorDynamicContext,
    contextCache,
  } = pack.buildRuntimeExecution(runtimeAgents, skillCatalog, bootstrapContext);

  const graphHooks = pack.buildGraphHooks?.(bootstrapContext) ?? pack.graphHooks ?? {};
  const messageHistoryMaxTokens =
    graphHooks.messageHistoryMaxTokens ?? pack.config.messageHistoryMaxTokens;

  let checkpointer = graphHooks.checkpointer;
  if (!checkpointer && pack.createCheckpointer) {
    checkpointer = await pack.createCheckpointer(bootstrapContext);
  }

  const graph = createAssistant<TDeps>({
    supervisorLlm: pack.supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository,
    capabilityDeps,
    loadPromptByKey,
    runtimeAgentPolicy,
    loadSupervisorPrompt: pack.loadSupervisorPrompt,
    ...(buildSupervisorDynamicContext
      ? { buildSupervisorDynamicContext }
      : {}),
    ...(contextCache ? { contextCache } : {}),
    replyUx: graphHooks.replyUx ?? defaultReplyUxConfig,
    ...(graphHooks.promptLogging ? { promptLogging: graphHooks.promptLogging } : {}),
    ...(graphHooks.cronTriggerResolver ? { cronTriggerResolver: graphHooks.cronTriggerResolver } : {}),
    ...(messageHistoryMaxTokens !== undefined ? { messageHistoryMaxTokens } : {}),
    ...(checkpointer ? { checkpointer } : {}),
  });

  return {
    config: pack.config,
    graph,
    runtimeAgentRepository,
    cronJobRepository,
    cronTargetAgentIds,
    runtimeAgents,
    skillCatalog,
    capabilityDeps,
    adapters,
  };
};
