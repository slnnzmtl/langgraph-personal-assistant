import path from "node:path";

import { createRuntimeAgentRepository } from "../../core/agents/repository.js";
import type { RuntimeAgentRepository } from "../../core/agents/repository.js";
import type { SupervisorPaths } from "../types.js";

export const createFileRuntimeAgentRepository = (
  config: SupervisorPaths,
  rootDir: string = process.cwd(),
): RuntimeAgentRepository =>
  createRuntimeAgentRepository(
    rootDir,
    path.relative(rootDir, config.runtimeAgentsFilePath),
  );
