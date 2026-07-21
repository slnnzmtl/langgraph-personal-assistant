import path from "node:path";

import { createRuntimeAgentRepository } from "../../core/agents/repository.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import { migrateLegacyExecutorAgent } from "./agent-legacy.js";

export const createRuntimeAgentRepositoryForConfig = (
  runtimeAgentsFilePath: string,
  cwd = process.cwd(),
): RuntimeAgentRepository =>
  createRuntimeAgentRepository(cwd, path.relative(cwd, runtimeAgentsFilePath), {
    transformAgent: migrateLegacyExecutorAgent,
  });
