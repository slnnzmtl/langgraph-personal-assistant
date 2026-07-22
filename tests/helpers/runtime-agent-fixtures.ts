import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isRuntimeAgentBuiltin,
  RuntimeAgentsDocumentSchema,
  type RuntimeAgentDefinition,
} from "../../src/core/types/agent.js";
import { buildDefaultRuntimeAgents } from "../../src/app/composition/bootstrap-agents.js";

const RUNTIME_AGENTS_FIXTURE_PATH = path.resolve(process.cwd(), "data/runtime-agents.json");

const DOMAIN_MODULE_CAPABILITY_IDS = new Set(["finance-domain", "obsidian-vault"]);

const isLocalModuleAgent = (definition: RuntimeAgentDefinition): boolean =>
  !isRuntimeAgentBuiltin(definition)
  && definition.capabilityIds.some((capabilityId) => DOMAIN_MODULE_CAPABILITY_IDS.has(capabilityId));

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

export const defaultTestCronTargetAgentIds = (): readonly string[] =>
  buildTestRuntimeAgents().filter((agent) => agent.enabled).map((agent) => agent.id);
