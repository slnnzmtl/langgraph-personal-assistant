import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { createSystemAgentDefinition } from "../../src/framework/system-agent/definition.js";
import {
  RUNTIME_AGENT_CONTEXT_KEY,
  resolveCronTriggerRoute,
  SUPERVISE_CRON_ROUTE,
} from "../../src/index.js";
import { createSupervisorNode } from "../../src/core/supervisor/supervisor-node.js";
import type { AgentState, AgentStateUpdate } from "../../src/core/state.js";
import type { ILLMConnector } from "../../src/core/ports/llm-connector.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";

export const TEST_SUPERVISOR_PROMPT = "You are the test supervisor for unit tests.";

export const loadTestSupervisorPrompt = (): string => TEST_SUPERVISOR_PROMPT;

export const buildTestRuntimeAgents = (): RuntimeAgentDefinition[] => [
  createSystemAgentDefinition({
    modelKey: "configuration",
  }),
  {
    id: "finance",
    name: "Finance",
    description: "Finance agent",
    systemPrompt: "finance",
    promptSourceKey: "finance",
    capabilityIds: ["finance-domain"],
    modelKey: "finance",
    maxSteps: 10,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Obsidian agent",
    systemPrompt: "obsidian",
    promptSourceKey: "obsidian",
    capabilityIds: ["obsidian-vault"],
    modelKey: "obsidian",
    maxSteps: 12,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const defaultTestCronTargetAgentIds = (): readonly string[] =>
  buildTestRuntimeAgents().filter((agent) => agent.enabled).map((agent) => agent.id);

export const getStateUpdateMessages = (
  update: Pick<AgentStateUpdate, "messages">,
): BaseMessage[] | undefined =>
  Array.isArray(update.messages) ? update.messages : undefined;

export const firstStateUpdateMessage = (
  update: Pick<AgentStateUpdate, "messages">,
): BaseMessage | undefined =>
  getStateUpdateMessages(update)?.[0];

export const getStateUpdateContext = (
  update: Pick<AgentStateUpdate, "context">,
): Record<string, unknown> | undefined => {
  const { context } = update;
  if (context === undefined || typeof context !== "object" || Array.isArray(context)) {
    return undefined;
  }

  return context as Record<string, unknown>;
};

export const getStateUpdateRuntimeAgentId = (
  update: Pick<AgentStateUpdate, "context">,
): string | undefined => {
  const value = getStateUpdateContext(update)?.[RUNTIME_AGENT_CONTEXT_KEY];
  return typeof value === "string" ? value : undefined;
};

export const asAgentState = (
  partial: Partial<AgentState> & Pick<AgentState, "messages">,
): AgentState => partial as AgentState;

export const getMessageText = (message: BaseMessage | undefined): string => {
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "string" ? block : "text" in block ? String(block.text) : ""))
      .join("");
  }

  return String(content ?? "");
};

export const makeTestRuntimeAgent = (
  overrides: Partial<RuntimeAgentDefinition> & Pick<RuntimeAgentDefinition, "id" | "name">,
): RuntimeAgentDefinition => ({
  description: "",
  systemPrompt: "",
  capabilityIds: [],
  maxSteps: 8,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

export const makeHumanState = (text: string, overrides?: Partial<AgentState>): AgentState =>
  asAgentState({
    messages: [new HumanMessage(text)],
    context: {},
    next: undefined,
    ...overrides,
  });

export const createRuntimeAgentRepositoryFake = (
  initialAgents: RuntimeAgentDefinition[] = buildTestRuntimeAgents(),
): RuntimeAgentRepository => {
  let storedAgents = [...initialAgents];

  return {
    loadAgents: async () => [...storedAgents],
    getAgent: async (id: string) => storedAgents.find((agent) => agent.id === id),
    saveAgents: async (agents) => {
      storedAgents = [...agents];
    },
    createAgent: async (input) => {
      if (!input.capabilityIds) {
        throw new Error("capabilityIds are required");
      }

      const timestamp = new Date().toISOString();
      const id = input.name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
      const nextAgent: RuntimeAgentDefinition = {
        id,
        name: input.name.trim(),
        description: input.description.trim(),
        systemPrompt: input.systemPrompt.trim(),
        capabilityIds: input.capabilityIds,
        ...(input.modelKey ? { modelKey: input.modelKey } : {}),
        maxSteps: input.maxSteps ?? 8,
        enabled: input.enabled ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      storedAgents = [...storedAgents, nextAgent];
      return nextAgent;
    },
    updateAgent: async (id, input) => {
      const index = storedAgents.findIndex((agent) => agent.id === id);
      if (index < 0) {
        throw new Error(`Runtime agent not found: ${id}`);
      }

      const current = storedAgents[index]!;
      const updated: RuntimeAgentDefinition = {
        ...current,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt.trim() } : {}),
        ...(input.capabilityIds !== undefined ? { capabilityIds: input.capabilityIds } : {}),
        ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
        ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date().toISOString(),
      };
      storedAgents[index] = updated;
      return updated;
    },
    deleteAgent: async (id) => {
      const found = storedAgents.find((agent) => agent.id === id);
      if (!found) {
        throw new Error(`Runtime agent not found: ${id}`);
      }
      storedAgents = storedAgents.filter((agent) => agent.id !== id);
      return found;
    },
  };
};

export const createTestSupervisorNode = (
  llmConnector: ILLMConnector,
  options?: {
    runtimeAgentRepository?: RuntimeAgentRepository;
    loadSupervisorPrompt?: () => string;
    buildSupervisorDynamicContext?: () => string;
    contextCache?: Parameters<typeof createSupervisorNode>[1]["contextCache"];
    wiredAgentIds?: ReadonlySet<string>;
    maxErrorRetries?: number;
  },
) => {
  const defaultWiredAgentIds = new Set(
    buildTestRuntimeAgents().filter((agent) => agent.enabled).map((agent) => agent.id),
  );

  return createSupervisorNode(llmConnector, {
    wiredAgentIds: options?.wiredAgentIds ?? defaultWiredAgentIds,
    loadSupervisorPrompt: options?.loadSupervisorPrompt ?? loadTestSupervisorPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) =>
        resolveCronTriggerRoute(message, defaultTestCronTargetAgentIds()) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    ...(options?.runtimeAgentRepository
      ? { runtimeAgentRepository: options.runtimeAgentRepository }
      : {}),
    ...(options?.buildSupervisorDynamicContext
      ? { buildSupervisorDynamicContext: options.buildSupervisorDynamicContext }
      : {}),
    ...(options?.contextCache ? { contextCache: options.contextCache } : {}),
    ...(options?.maxErrorRetries !== undefined ? { maxErrorRetries: options.maxErrorRetries } : {}),
  });
};
