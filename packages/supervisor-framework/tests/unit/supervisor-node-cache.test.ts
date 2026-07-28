import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";

import type { ContextCacheKit } from "../../src/index.js";
import type { ILLMConnector } from "../../src/core/ports/llm-connector.js";
import {
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
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(String(messages[0]?.content)).toContain("<turn_context>");
    expect(String(messages[0]?.content)).toContain("CURRENT DATETIME: now");
    expect(messages.some((message) => message instanceof SystemMessage)).toBe(false);
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
