import { readFileSync } from "node:fs";
import path from "node:path";

import {
  RuntimeAgentsDocumentSchema,
  isLocalModuleAgent,
  type RuntimeAgentDefinition,
} from "../../src/core/types/agent.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/builtin-domains.js";

const RUNTIME_AGENTS_FIXTURE_PATH = path.resolve(process.cwd(), "data/runtime-agents.json");

export const loadLocalModuleAgentsFromFixture = (): RuntimeAgentDefinition[] => {
  const raw = readFileSync(RUNTIME_AGENTS_FIXTURE_PATH, "utf8");
  const document = RuntimeAgentsDocumentSchema.parse(JSON.parse(raw));
  return document.agents.filter(isLocalModuleAgent);
};

export const buildLocalModuleAgents = (): RuntimeAgentDefinition[] =>
  loadLocalModuleAgentsFromFixture();

export const buildTestRuntimeAgents = (): RuntimeAgentDefinition[] => [
  ...buildDefaultRuntimeAgents(),
  ...buildLocalModuleAgents(),
];

export const getRuntimeAgentFixture = (id: string): RuntimeAgentDefinition => {
  const definition = buildTestRuntimeAgents().find((agent) => agent.id === id);

  if (!definition) {
    throw new Error(`Runtime agent fixture not found: ${id}`);
  }

  return definition;
};

/** @deprecated Use getRuntimeAgentFixture */
export const getBuiltinRuntimeAgentDefinition = getRuntimeAgentFixture;

export const defaultTestCronTargetAgentIds = (): readonly string[] =>
  buildTestRuntimeAgents().filter((agent) => agent.enabled).map((agent) => agent.id);
