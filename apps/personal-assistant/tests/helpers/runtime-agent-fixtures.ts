import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSystemAgentDefinition,
  isRuntimeAgentBuiltin,
  RuntimeAgentsDocumentSchema,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import {
  FINANCE_DOMAIN_CAPABILITY_ID,
} from "../../src/runtime-agents/finance/tools.js";
import {
  OBSIDIAN_VAULT_CAPABILITY_ID,
} from "../../src/runtime-agents/obsidian/tools.js";

const RUNTIME_AGENTS_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/runtime-agents.json",
);

const DOMAIN_MODULE_CAPABILITY_IDS = new Set<string>([
  FINANCE_DOMAIN_CAPABILITY_ID,
  OBSIDIAN_VAULT_CAPABILITY_ID,
]);

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
  createSystemAgentDefinition({
    modelKey: "configuration",
  }),
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
