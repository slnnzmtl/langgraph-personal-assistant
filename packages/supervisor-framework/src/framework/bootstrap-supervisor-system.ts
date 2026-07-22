import { createAssistant } from "../core/create-assistant.js";
import { defaultReplyUxConfig } from "../core/supervisor/reply-ux.js";
import { createEmptySkillCatalog } from "./defaults/empty-skill-catalog.js";
import { createFileRuntimeAgentRepository } from "./defaults/file-runtime-agent-repository.js";
import { createNoopCronJobRepository } from "./defaults/noop-cron-job-repository.js";
import { deriveCronTargetAgentIds } from "./derive-agents.js";
import type {
  SupervisorPackBootstrap,
  SupervisorPaths,
  SupervisorSystemContext,
} from "./types.js";

export const bootstrapSupervisorSystem = async <
  TConfig extends SupervisorPaths,
  TDeps extends Record<string, unknown>,
  TAdapters extends Record<string, unknown> = Record<string, never>,
>(
  pack: SupervisorPackBootstrap<TConfig, TDeps, TAdapters>,
): Promise<SupervisorSystemContext<TConfig, TDeps>> => {
  const adapters = pack.setupAdapters ? await pack.setupAdapters(pack.config) : ({} as TAdapters);

  const runtimeAgentRepository =
    pack.createRuntimeAgentRepository?.(pack.config) ??
    createFileRuntimeAgentRepository(pack.config);

  const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, { adapters });

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const cronJobRepository =
    pack.createCronJobRepository?.(pack.config.cronJobsFilePath, cronTargetAgentIds) ??
    createNoopCronJobRepository();
  const skillCatalog = pack.buildSkillCatalog?.(runtimeAgents) ?? createEmptySkillCatalog();

  const bootstrapContext = {
    config: pack.config,
    runtimeAgentRepository,
    runtimeAgents,
    cronTargetAgentIds,
    cronJobRepository,
    capabilityCatalog: pack.capabilityCatalog,
    skillCatalog,
    adapters,
  };

  const capabilityDeps = pack.buildCapabilityDeps(bootstrapContext);
  const defaultModelKey = "generic";
  const models = pack.buildModels(pack.config, runtimeAgents);
  const { loadPromptByKey, policyRegistry } = pack.buildPolicyRegistry(runtimeAgents, skillCatalog);

  const graphHooks = pack.buildGraphHooks?.(bootstrapContext) ?? pack.graphHooks ?? {};
  const messageHistoryMaxTokens =
    graphHooks.messageHistoryMaxTokens ?? pack.config.messageHistoryMaxTokens;

  const graph = createAssistant<TDeps>({
    supervisorLlm: pack.supervisorLlm,
    models,
    runtimeAgents,
    defaultModelKey,
    runtimeAgentRepository,
    capabilityDeps,
    loadPromptByKey,
    policyRegistry,
    loadSupervisorPrompt: pack.loadSupervisorPrompt,
    replyUx: graphHooks.replyUx ?? defaultReplyUxConfig,
    ...(graphHooks.promptLogging ? { promptLogging: graphHooks.promptLogging } : {}),
    ...(graphHooks.cronTriggerResolver ? { cronTriggerResolver: graphHooks.cronTriggerResolver } : {}),
    ...(messageHistoryMaxTokens !== undefined ? { messageHistoryMaxTokens } : {}),
  });

  return {
    config: pack.config,
    graph,
    cronJobRepository,
    cronTargetAgentIds,
    runtimeAgents,
    skillCatalog,
    capabilityDeps,
  };
};
