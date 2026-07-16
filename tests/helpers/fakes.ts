import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import type { ILLMConnector, RoutingChain } from "../../src/connectors/llm-connector.js";
import type { RuntimeAgentRepository } from "../../src/runtime-agents/repository.js";
import { buildDefaultRuntimeAgents } from "../../src/runtime-agents/defaults.js";
import { createRuntimeAgentExecutionContext } from "../../src/runtime-agents/execution-context.js";
import type {
  BuiltinRuntimeAgentId,
  RuntimeAgentDefinition,
} from "../../src/runtime-agents/types.js";
import type { CronJobRepository } from "../../src/cron/types.js";

export class FakeRunnable<TInput, TOutput> {
  constructor(private readonly handler: (input: TInput) => Promise<TOutput> | TOutput) {}

  async invoke(input: TInput): Promise<TOutput> {
    return this.handler(input);
  }
}

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

  bindRoutingTools<TRoute extends Record<string, unknown>>(_schema: z.ZodType<TRoute>): RoutingChain<TRoute> {
    return new FakeRunnable(async (input: any) => this.handler(input)) as unknown as RoutingChain<TRoute>;
  }
}

export const latestMessageText = (messages: BaseMessage[]): string => {
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage) {
    throw new Error("No messages found.");
  }

  if (typeof lastMessage.content === "string") {
    return lastMessage.content;
  }

  return JSON.stringify(lastMessage.content);
};

export const makeHumanState = (text: string) => ({
  messages: [new HumanMessage(text)],
  context: {},
  next: undefined,
});

export const makeAiMessage = (text: string) => new AIMessage(text);

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
        skillAttachments: input.skillAttachments ?? [],
        executor: input.executor ?? "generic",
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
        ...(input.skillAttachments !== undefined ? { skillAttachments: input.skillAttachments } : {}),
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

export const defaultConfigurationBundleDeps = {
  obsidianVaultPath: "/tmp/pa-unit-vault",
};

export const getBuiltinRuntimeAgentDefinition = (
  id: BuiltinRuntimeAgentId,
): RuntimeAgentDefinition => {
  const definition = buildDefaultRuntimeAgents().find((agent) => agent.id === id);

  if (!definition) {
    throw new Error(`Built-in runtime agent not found: ${id}`);
  }

  return definition;
};

export const createRuntimeExecutionContextFake = (options?: {
  repository?: RuntimeAgentRepository;
  cronJobRepository?: CronJobRepository;
  llmConnector?: FakeLLMConnector;
  obsidianVaultPath?: string;
}) => {
  const llmConnector = options?.llmConnector ?? new FakeLLMConnector(() => new AIMessage("unused"));
  const model = llmConnector.getModel();

  return createRuntimeAgentExecutionContext({
    genericModel: model,
    financeModel: model,
    obsidianLlmConnector: llmConnector,
    configurationModel: model,
    repository: options?.repository ?? createRuntimeAgentRepositoryFake(),
    cronJobRepository: options?.cronJobRepository ?? {
      loadJobs: async () => [],
      saveJobs: async () => {},
    },
    obsidianVaultPath: options?.obsidianVaultPath ?? defaultConfigurationBundleDeps.obsidianVaultPath,
  });
};
