import {
  createRuntimeAgentRepositoryForConfig as createCoreRepositoryForConfig,
  type RuntimeAgentRepository,
} from "../core/agents/repository.js";

export const APP_BUILTIN_AGENT_IDS = ["finance", "obsidian", "configuration"] as const;

export type AppBuiltinAgentId = (typeof APP_BUILTIN_AGENT_IDS)[number];

export type BuiltinRuntimeAgentId = AppBuiltinAgentId;

export const BUILTIN_RUNTIME_AGENT_IDS = APP_BUILTIN_AGENT_IDS;

export const isBuiltinRuntimeAgentId = (value: string): value is BuiltinRuntimeAgentId =>
  (APP_BUILTIN_AGENT_IDS as readonly string[]).includes(value as BuiltinRuntimeAgentId);

export const createRuntimeAgentRepositoryForConfig = (
  runtimeAgentsFilePath: string,
  cwd = process.cwd(),
): RuntimeAgentRepository =>
  createCoreRepositoryForConfig(runtimeAgentsFilePath, {
    builtinAgentIds: APP_BUILTIN_AGENT_IDS,
  }, cwd);
