import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";

import type { ContextCacheKit } from "../../src/index.js";
import type { ILLMConnector } from "../../src/core/ports/llm-connector.js";
import {
  createRuntimeAgentRepositoryFake,
  createTestSupervisorNode,
  makeHumanState,
} from "../helpers/supervisor-node-fixtures.js";

describe("createSupervisorNode context cache", () => {
  it("uses turn_context and a cached model when cache hits", async () => {
    const invokeInputs: unknown[] = [];
    const bindOptions: unknown[] = [];
    const cachedModel = { id: "cached-supervisor-model" } as unknown as BaseChatModel;

    const connector: ILLMConnector = {
      getModel: () => ({ invoke: async () => new AIMessage("unused") }) as unknown as BaseChatModel,
      bindRoutingTools: (_schema, options) => {
        bindOptions.push(options);
        return {
          invoke: async (input: unknown) => {
            invokeInputs.push(input);
            return { next: "FINISH", reply: "ok" };
          },
        };
      },
    };

    const createCachedModel = vi.fn(() => cachedModel);
    const contextCache: ContextCacheKit = {
      cacheManager: {
        getOrCreate: async () => ({
          cacheName: "cachedContents/supervisor-1",
          model: "models/gemini-2.5-flash-lite",
        }),
        invalidate: () => undefined,
      },
      apiKey: "test-key",
      supervisorModelName: "gemini-2.5-flash-lite",
      resolveRuntimeModelName: () => "gemini-2.5-flash",
      createCachedModel,
    };

    const supervisorNode = createTestSupervisorNode(connector, {
      loadSupervisorPrompt: () => "STATIC SUPERVISOR PROMPT",
      buildSupervisorDynamicContext: () => "<system_metadata>\nCURRENT DATETIME: now\n</system_metadata>",
      contextCache,
    });

    const result = await supervisorNode(makeHumanState("hello"));

    expect(result.next).toBe("FINISH");
    expect(createCachedModel).toHaveBeenCalledWith(
      "test-key",
      "gemini-2.5-flash-lite",
      expect.objectContaining({
        cacheName: "cachedContents/supervisor-1",
        model: "models/gemini-2.5-flash-lite",
      }),
    );
    expect(bindOptions[0]).toEqual({ model: cachedModel });

    const messages = invokeInputs[0] as Array<{ content: unknown }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(String(messages[0]?.content)).toContain("<turn_context>");
    expect(String(messages[0]?.content)).toContain("CURRENT DATETIME: now");
    expect(String(messages[0]?.content)).toContain("hello");
    expect(messages.some((message) => message instanceof SystemMessage)).toBe(false);
  });

  it("keeps post-handoff turn_context off stale earlier user turns", async () => {
    const invokeInputs: unknown[] = [];
    const cachedModel = { id: "cached-supervisor-model" } as unknown as BaseChatModel;

    const connector: ILLMConnector = {
      getModel: () => ({ invoke: async () => new AIMessage("unused") }) as unknown as BaseChatModel,
      bindRoutingTools: () => ({
        invoke: async (input: unknown) => {
          invokeInputs.push(input);
          return {
            next: "FINISH",
            reply: "I've synced yesterday's transactions (2026-07-31).",
          };
        },
      }),
    };

    const contextCache: ContextCacheKit = {
      cacheManager: {
        getOrCreate: async () => ({
          cacheName: "cachedContents/supervisor-1",
          model: "models/gemini-2.5-flash-lite",
        }),
        invalidate: () => undefined,
      },
      apiKey: "test-key",
      supervisorModelName: "gemini-2.5-flash-lite",
      resolveRuntimeModelName: () => "gemini-2.5-flash",
      createCachedModel: () => cachedModel,
    };

    const supervisorNode = createTestSupervisorNode(connector, {
      loadSupervisorPrompt: () => "STATIC SUPERVISOR PROMPT",
      buildSupervisorDynamicContext: () => "<system_metadata>\nCURRENT DATETIME: now\n</system_metadata>",
      contextCache,
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    await supervisorNode(makeHumanState("sync expenses", {
      messages: [
        new HumanMessage("list runtime agents"),
        new AIMessage("Agent ID: configuration\nAgent ID: finance"),
        new HumanMessage("sync expenses"),
        new AIMessage("I've synced yesterday's transactions (2026-07-31)."),
      ],
      lastHandoff: {
        kind: "runtime-agent-handoff",
        agentId: "finance",
        agentName: "Finance",
        status: "ok",
      },
      executionQueue: [],
    }));

    const messages = invokeInputs[0] as Array<{ content: unknown }>;
    expect(String(messages[0]?.content)).toBe("list runtime agents");
    expect(String(messages[0]?.content)).not.toContain("<turn_context>");

    const last = messages[messages.length - 1];
    expect(last).toBeInstanceOf(HumanMessage);
    expect(String(last?.content)).toContain("<turn_context>");
    expect(String(last?.content)).toContain("Latest user message: sync expenses");
    expect(String(last?.content)).toContain('runtime agent "finance" just completed');
    expect(String(last?.content)).not.toContain("list runtime agents");
  });

  it("invalidates and recreates cache when CachedContent is missing", async () => {
    const invokeInputs: unknown[] = [];
    let invokeCount = 0;
    const invalidate = vi.fn();
    let getOrCreateCount = 0;
    const cachedModel = { id: "cached-supervisor-model" } as unknown as BaseChatModel;
    const recreatedModel = { id: "recreated-supervisor-model" } as unknown as BaseChatModel;

    const connector: ILLMConnector = {
      getModel: () => ({ invoke: async () => new AIMessage("unused") }) as unknown as BaseChatModel,
      bindRoutingTools: (_schema, options) => ({
        invoke: async (input: unknown) => {
          invokeCount += 1;
          invokeInputs.push(input);
          if (invokeCount === 1) {
            expect(options).toEqual({ model: cachedModel });
            throw new Error(
              "[GoogleGenerativeAI Error]: [403 Forbidden] CachedContent not found (or permission denied)",
            );
          }

          expect(options).toEqual({ model: recreatedModel });
          return { next: "obsidian" };
        },
      }),
    };

    const contextCache: ContextCacheKit = {
      cacheManager: {
        getOrCreate: async () => {
          getOrCreateCount += 1;
          return {
            cacheName: getOrCreateCount === 1
              ? "cachedContents/stale"
              : "cachedContents/fresh",
            model: "models/gemini-2.5-flash-lite",
          };
        },
        invalidate,
      },
      apiKey: "test-key",
      supervisorModelName: "gemini-2.5-flash-lite",
      resolveRuntimeModelName: () => "gemini-2.5-flash",
      createCachedModel: (_apiKey, _modelName, handle) =>
        handle.cacheName === "cachedContents/stale" ? cachedModel : recreatedModel,
    };

    const supervisorNode = createTestSupervisorNode(connector, {
      loadSupervisorPrompt: () => "STATIC SUPERVISOR PROMPT",
      buildSupervisorDynamicContext: () => "<system_metadata>\nCURRENT DATETIME: now\n</system_metadata>",
      contextCache,
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("Create routines for today"));

    expect(result.next).toBe("obsidian");
    expect(invalidate).toHaveBeenCalledWith("cachedContents/stale");
    expect(getOrCreateCount).toBe(2);
    expect(invokeCount).toBe(2);
    expect(invokeInputs[1]).toBe(invokeInputs[0]);
  });

  it("falls back to uncached routing when cache recreate still fails", async () => {
    const invokeInputs: unknown[] = [];
    let invokeCount = 0;
    const invalidate = vi.fn();
    const cachedModel = { id: "cached-supervisor-model" } as unknown as BaseChatModel;

    const connector: ILLMConnector = {
      getModel: () => ({ invoke: async () => new AIMessage("unused") }) as unknown as BaseChatModel,
      bindRoutingTools: (_schema, options) => ({
        invoke: async (input: unknown) => {
          invokeCount += 1;
          invokeInputs.push(input);
          if (invokeCount <= 2) {
            expect(options).toEqual({ model: cachedModel });
            throw new Error(
              "[GoogleGenerativeAI Error]: [403 Forbidden] CachedContent not found (or permission denied)",
            );
          }

          expect(options).toBeUndefined();
          return { next: "obsidian" };
        },
      }),
    };

    const contextCache: ContextCacheKit = {
      cacheManager: {
        getOrCreate: async () => ({
          cacheName: "cachedContents/stale",
          model: "models/gemini-2.5-flash-lite",
        }),
        invalidate,
      },
      apiKey: "test-key",
      supervisorModelName: "gemini-2.5-flash-lite",
      resolveRuntimeModelName: () => "gemini-2.5-flash",
      createCachedModel: () => cachedModel,
    };

    const supervisorNode = createTestSupervisorNode(connector, {
      loadSupervisorPrompt: () => "STATIC SUPERVISOR PROMPT",
      buildSupervisorDynamicContext: () => "<system_metadata>\nCURRENT DATETIME: now\n</system_metadata>",
      contextCache,
      runtimeAgentRepository: createRuntimeAgentRepositoryFake(),
    });

    const result = await supervisorNode(makeHumanState("Create routines for today"));

    expect(result.next).toBe("obsidian");
    expect(invalidate).toHaveBeenCalledWith("cachedContents/stale");
    expect(invokeCount).toBe(3);

    const retryMessages = invokeInputs[2] as Array<{ content: unknown }>;
    expect(retryMessages[0]).toBeInstanceOf(SystemMessage);
    expect(String(retryMessages[0]?.content)).toContain("STATIC SUPERVISOR PROMPT");
  });

  it("falls back to SystemMessage when cache returns null", async () => {
    const invokeInputs: unknown[] = [];

    const connector: ILLMConnector = {
      getModel: () => ({ invoke: async () => new AIMessage("unused") }) as unknown as BaseChatModel,
      bindRoutingTools: () => ({
        invoke: async (input: unknown) => {
          invokeInputs.push(input);
          return { next: "FINISH", reply: "ok" };
        },
      }),
    };

    const contextCache: ContextCacheKit = {
      cacheManager: {
        getOrCreate: async () => null,
        invalidate: () => undefined,
      },
      apiKey: "test-key",
      supervisorModelName: "gemini-2.5-flash-lite",
      resolveRuntimeModelName: () => "gemini-2.5-flash",
      createCachedModel: () => {
        throw new Error("should not create cached model on miss");
      },
    };

    const supervisorNode = createTestSupervisorNode(connector, {
      loadSupervisorPrompt: () => "STATIC SUPERVISOR PROMPT",
      buildSupervisorDynamicContext: () => "<system_metadata>\nCURRENT DATETIME: now\n</system_metadata>",
      contextCache,
    });

    await supervisorNode(makeHumanState("hello"));

    const messages = invokeInputs[0] as Array<{ content: unknown }>;
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(String(messages[0]?.content)).toContain("STATIC SUPERVISOR PROMPT");
    expect(String(messages[0]?.content)).toContain("CURRENT DATETIME: now");
  });
});
