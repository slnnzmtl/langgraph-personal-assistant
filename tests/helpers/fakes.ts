import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import type { ILLMConnector, RoutingChain } from "../../src/connectors/llm-connector.js";
import { loadSupervisorSystemPrompt } from "../../src/prompts/load-system-prompt.js";
import { createSupervisorNode } from "../../src/core/supervisor/supervisor-node.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import { resolveCronTriggerRoute, SUPERVISE_CRON_ROUTE } from "../../src/cron-triggers.js";
import { defaultCronTargetAgentIds } from "../../src/app/runtime-agent-catalog.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/builtin-domains.js";
import { RUNTIME_AGENT_CONTEXT_KEY, type RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import type { CronJobRepository } from "../../src/cron/types.js";
import type { RuntimeToolBundleDeps } from "../../src/runtime-agents/tool-bundles.js";
import type { AgentStateUpdate } from "../../src/core/state.js";
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

export const makeHumanState = (text: string) => ({
  messages: [new HumanMessage(text)],
  context: {},
  next: undefined,
});

export const createRuntimeAgentRepositoryFake = (
  initialAgents: RuntimeAgentDefinition[] = buildDefaultRuntimeAgents(),
): RuntimeAgentRepository => {
  let storedAgents = [...initialAgents];

  return {
    loadAgents: async () => [...storedAgents],
    getAgent: async (id: string) => storedAgents.find((agent) => agent.id === id),
    saveAgents: async (agents) => {
      storedAgents = [...agents];
    },
    createAgent: async (input) => {
      const timestamp = new Date().toISOString();
      const id = input.name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
      const nextAgent: RuntimeAgentDefinition = {
        id,
        name: input.name.trim(),
        description: input.description.trim(),
        systemPrompt: input.systemPrompt.trim(),
        toolBundleIds: input.toolBundleIds,
        executor: input.executor ?? "generic",
        builtin: false,
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
        ...(input.toolBundleIds !== undefined ? { toolBundleIds: input.toolBundleIds } : {}),
        ...(input.executor !== undefined ? { executor: input.executor } : {}),
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

export const defaultConfigurationBundleDeps: RuntimeToolBundleDeps = {
  obsidianVaultPath: "/tmp/pa-unit-vault",
  cronTargetAgentIds: defaultCronTargetAgentIds(),
};

export const getBuiltinRuntimeAgentDefinition = (
  id: string,
): RuntimeAgentDefinition => {
  const definition = buildDefaultRuntimeAgents().find((agent) => agent.id === id);

  if (!definition) {
    throw new Error(`Built-in runtime agent not found: ${id}`);
  }

  return definition;
};

export const createAppSupervisorNode = (
  llmConnector: ILLMConnector,
  options?: {
    runtimeAgentRepository?: RuntimeAgentRepository;
    loadSupervisorPrompt?: () => string;
  },
) =>
  createSupervisorNode(llmConnector, {
    loadSupervisorPrompt: options?.loadSupervisorPrompt ?? loadSupervisorSystemPrompt,
    cronTriggerResolver: {
      resolveCronTriggerRoute: (message) =>
        resolveCronTriggerRoute(message, defaultCronTargetAgentIds()) ?? undefined,
      superviseCronRoute: SUPERVISE_CRON_ROUTE,
    },
    ...(options?.runtimeAgentRepository
      ? { runtimeAgentRepository: options.runtimeAgentRepository }
      : {}),
  });

export const createRuntimeExecutionContextFake = (options?: {
  repository?: RuntimeAgentRepository;
  cronJobRepository?: CronJobRepository;
  llmConnector?: FakeLLMConnector;
  obsidianVaultPath?: string;
}) => {
  const llmConnector = options?.llmConnector ?? new FakeLLMConnector(() => new AIMessage("unused"));
  const model = llmConnector.getModel();

  return createAppRuntimeExecutionContext({
    defaultModel: model,
    repository: options?.repository ?? createRuntimeAgentRepositoryFake(),
    cronJobRepository: options?.cronJobRepository ?? {
      loadJobs: async () => [],
      saveJobs: async () => {},
    },
    bundleDeps: {
      obsidianVaultPath: options?.obsidianVaultPath ?? defaultConfigurationBundleDeps.obsidianVaultPath,
      cronTargetAgentIds: defaultConfigurationBundleDeps.cronTargetAgentIds,
      cronJobRepository: options?.cronJobRepository ?? {
        loadJobs: async () => [],
        saveJobs: async () => {},
      },
      runtimeAgentRepository: options?.repository ?? createRuntimeAgentRepositoryFake(),
    },
  });
};
