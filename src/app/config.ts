import {
  createRuntimeAgentRepositoryForConfig as createCoreRepositoryForConfig,
  type RuntimeAgentRepository,
} from "../core/agents/repository.js";

export const createRuntimeAgentRepositoryForConfig = (
  runtimeAgentsFilePath: string,
  cwd = process.cwd(),
): RuntimeAgentRepository =>
  createCoreRepositoryForConfig(runtimeAgentsFilePath, cwd);
