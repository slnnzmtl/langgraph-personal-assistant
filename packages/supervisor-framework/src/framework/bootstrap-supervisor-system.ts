import path from "node:path";

import { createAssistant } from "../core/create-assistant.js";
import { createRuntimeAgentRepository } from "../core/agents/repository.js";
import { createPolicyRegistry } from "../core/policies/registry.js";
import { defaultReplyUxConfig } from "../core/supervisor/reply-ux.js";
import { createEmptySkillCatalog } from "./defaults/empty-skill-catalog.js";
import { createNoopCronJobRepository } from "./defaults/noop-cron-job-repository.js";
import { deriveCronTargetAgentIds } from "./derive-agents.js";
import { resolveAgentTools } from "./resolve-agent-tools.js";
import {
  createSystemAgentPolicy,
  mergeCapabilityCatalogs,
  seedSystemAgent,
  type SystemAgentPolicyOptions,
  type SystemAgentRepository,
  wrapRepositoryWithSystemAgent,
} from "./system-agent/index.js";
import type { SystemAgentOptions } from "./system-agent/types.js";
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
  const systemAgentEnabled = pack.systemAgent !== undefined && pack.systemAgent !== false;

  const baseRuntimeAgentRepository =
    pack.createRuntimeAgentRepository?.(pack.config) ??
    createRuntimeAgentRepository(
      process.cwd(),
      path.relative(process.cwd(), pack.config.runtimeAgentsFilePath),
    );

  const runtimeAgentRepository = systemAgentEnabled
    ? wrapRepositoryWithSystemAgent(baseRuntimeAgentRepository, pack.systemAgent as SystemAgentOptions)
    : baseRuntimeAgentRepository;

  if (systemAgentEnabled) {
    await seedSystemAgent(runtimeAgentRepository as SystemAgentRepository);
  }

  const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, { adapters });

  const cronTargetAgentIds = deriveCronTargetAgentIds(runtimeAgents);
  const cronJobRepository =
    pack.createCronJobRepository?.(pack.config.cronJobsFilePath, cronTargetAgentIds) ??
    createNoopCronJobRepository();
  const skillCatalog = pack.buildSkillCatalog?.(runtimeAgents) ?? createEmptySkillCatalog();

  const capabilityCatalog = systemAgentEnabled && pack.capabilityProviders
    ? mergeCapabilityCatalogs(pack.capabilityProviders, true)
    : pack.capabilityCatalog;

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
  const defaultModelKey = "generic";
  const models = pack.buildModels(pack.config, runtimeAgents);
  const { loadPromptByKey, policies, shellFormatters } = pack.buildPolicyRegistry(runtimeAgents, skillCatalog);

  const resolveTools =
    pack.resolveRuntimeAgentTools?.(capabilityCatalog, skillCatalog)
    ?? ((definition, deps, resolveOptions) =>
      resolveAgentTools(definition, capabilityCatalog, deps, {}, resolveOptions));

  const allPolicies = systemAgentEnabled
    ? [
        ...policies,
        createSystemAgentPolicy({
          capabilityCatalog,
          resolveTools: resolveTools as SystemAgentPolicyOptions["resolveTools"],
          systemAgent: pack.systemAgent as SystemAgentOptions,
          skillCatalog,
          ...(shellFormatters ? { shellFormatters } : {}),
        }),
      ]
    : policies;

  const policyRegistry = createPolicyRegistry(allPolicies);

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
