import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import {
  createSupervisorNode,
  RUNTIME_AGENT_CONTEXT_KEY,
  type AgentState,
  type AgentStateUpdate,
  type RuntimeAgentDefinition,
  type RuntimeAgentRepository,
  type SubAgentState,
} from "@personal-assistant/supervisor-framework";
import type { ILLMConnector, RoutingChain } from "@personal-assistant/supervisor-framework";
import { resolveCronTriggerRoute, SUPERVISE_CRON_ROUTE, type CronJobRepository } from "@personal-assistant/supervisor-framework";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load.js";
import type { PersonalCapabilityDeps } from "../../src/runtime-agents/system-capability-deps.js";
import {
  buildTestRuntimeAgents,
  defaultTestCronTargetAgentIds,
} from "./runtime-agent-fixtures.js";
export { getRuntimeAgentFixture } from "./runtime-agent-fixtures.js";
import { createAppRuntimeExecutionContext } from "./runtime-execution-context.js";

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

export class FakeRunnable<TInput, TOutput> {
  constructor(private readonly handler: (input: TInput) => Promise<TOutput> | TOutput) {}

  async invoke(input: TInput): Promise<TOutput> {
    return this.handler(input);
  }
}

export const normalizeFakeRuntimeResponse = (result: unknown): AIMessage => {
  if (result instanceof AIMessage) {
    return result;
  }

  if (result && typeof result === "object" && "next" in result) {
    return new AIMessage("");
  }

  if (typeof result === "string") {
    return new AIMessage(result);
  }

  return new AIMessage("Completed.");
};

export class FakeLLMConnector implements ILLMConnector {
  constructor(private readonly handler: (input: any) => any) {}

  getModel(): BaseChatModel {
    return {
      invoke: async (input: any) => this.handler(input),
      bindTools: () => ({
        invoke: async (input: any) => this.handler(input),
      }),
    } as unknown as BaseChatModel;
  }

  getSharedRuntimeModel(): BaseChatModel {
    const handler = this.handler;
    return {
      invoke: async (input: unknown) => normalizeFakeRuntimeResponse(await handler(input)),
      bindTools: () => ({
        invoke: async (input: unknown) => normalizeFakeRuntimeResponse(await handler(input)),
      }),
    } as unknown as BaseChatModel;
  }

  bindRoutingTools<TRoute extends Record<string, unknown>>(_schema: z.ZodType<TRoute>): RoutingChain<TRoute> {
    return new FakeRunnable(async (input: any) => this.handler(input)) as unknown as RoutingChain<TRoute>;
  }
}

export const asAgentState = (
  partial: Partial<AgentState> & Pick<AgentState, "messages">,
): AgentState => partial as AgentState;

export const asSubAgentState = (
  partial: Partial<SubAgentState> & Pick<SubAgentState, "agentMessages">,
): SubAgentState => partial as SubAgentState;

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

export const defaultConfigurationCapabilityDeps: PersonalCapabilityDeps = {
  cronTargetAgentIds: defaultTestCronTargetAgentIds(),
};

export const createAppSupervisorNode = (
  llmConnector: ILLMConnector,
  options?: {
    runtimeAgentRepository?: RuntimeAgentRepository;
    loadSupervisorPrompt?: () => string;
    wiredAgentIds?: ReadonlySet<string>;
  },
) => {
  const defaultWiredAgentIds = new Set(
    buildTestRuntimeAgents().filter((agent) => agent.enabled).map((agent) => agent.id),
  );

  return createSupervisorNode(llmConnector, {
    wiredAgentIds: options?.wiredAgentIds ?? defaultWiredAgentIds,
    loadSupervisorPrompt: options?.loadSupervisorPrompt ?? loadSupervisorSystemPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) =>
        resolveCronTriggerRoute(message, defaultTestCronTargetAgentIds()) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    ...(options?.runtimeAgentRepository
      ? { runtimeAgentRepository: options.runtimeAgentRepository }
      : {}),
  });
};

const emptyCronRepository = (): CronJobRepository => ({
  loadJobs: async () => [],
  saveJobs: async () => {},
  createJob: async (job) => job,
  deleteJob: async () => {
    throw new Error("Cron job not found");
  },
});

export const createRuntimeExecutionContextFake = (options?: {
  repository?: RuntimeAgentRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  cronJobRepository?: CronJobRepository;
  llmConnector?: FakeLLMConnector;
  capabilityDeps?: Partial<PersonalCapabilityDeps>;
}) => {
  const llmConnector = options?.llmConnector ?? new FakeLLMConnector(() => new AIMessage("unused"));
  const model = llmConnector.getModel();
  const cronJobRepository = options?.cronJobRepository ?? emptyCronRepository();
  const repository =
    options?.runtimeAgentRepository ?? options?.repository ?? createRuntimeAgentRepositoryFake();

  return createAppRuntimeExecutionContext({
    defaultModel: model,
    repository,
    capabilityDeps: {
      cronTargetAgentIds: defaultConfigurationCapabilityDeps.cronTargetAgentIds,
      cronJobRepository,
      runtimeAgentRepository: repository,
      ...options?.capabilityDeps,
    },
  });
};
