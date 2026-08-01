import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeAgentNode } from "../../src/index.js";
import { makeTestRuntimeAgent } from "../helpers/supervisor-node-fixtures.js";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const makeBaseModel = (bindToolsCalls: unknown[][]): BaseChatModel =>
  ({
    bindTools: (...args: unknown[]) => {
      bindToolsCalls.push(args);
      throw new Error("bindTools should not be called when a cached model is resolved for the turn.");
    },
    invoke: async () => new AIMessage("base model should not be invoked directly"),
  }) as unknown as BaseChatModel;

describe("createRuntimeAgentNode cache hooks", () => {
  it("skips bindTools and uses the cached model when resolveModelForTurn opts out of binding", async () => {
    const bindToolsCalls: unknown[][] = [];
    const baseModel = makeBaseModel(bindToolsCalls);

    let cachedInvokeMessages: unknown[] = [];
    const cachedModel = {
      invoke: async (messages: unknown[]) => {
        cachedInvokeMessages = messages;
        return new AIMessage("cached model reply");
      },
    } as unknown as BaseChatModel;

    const definition = makeTestRuntimeAgent({
      id: "configuration",
      name: "Configuration",
      systemPrompt: "base prompt",
    });

    const node = createRuntimeAgentNode(baseModel, definition, [echoTool], {
      resolveModelForTurn: () => ({
        model: cachedModel,
        bindTools: false,
        useCachedPromptLayout: true,
      }),
      buildPromptMessages: (_ctx, systemPromptText, stateMessages) => [
        new HumanMessage(`<turn_context>${systemPromptText}</turn_context>`),
        ...stateMessages,
      ],
    });

    const result = await node({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(bindToolsCalls).toHaveLength(0);
    expect(cachedInvokeMessages[0]).toBeInstanceOf(HumanMessage);
    expect(String((cachedInvokeMessages[0] as HumanMessage).content)).toContain("<turn_context>");
    expect(result.agentMessages?.[0]).toBeInstanceOf(AIMessage);
    expect(String(result.agentMessages?.[0]?.content)).toBe("cached model reply");
  });

  it("falls back to bindTools on the base model when resolveModelForTurn keeps binding enabled", async () => {
    const bindToolsCalls: unknown[][] = [];
    const boundModel = {
      invoke: async () => new AIMessage("bound model reply"),
    } as unknown as BaseChatModel;
    const baseModel = {
      bindTools: (...args: unknown[]) => {
        bindToolsCalls.push(args);
        return boundModel;
      },
      invoke: async () => new AIMessage("base model should not be invoked directly"),
    } as unknown as BaseChatModel;

    const definition = makeTestRuntimeAgent({
      id: "finance",
      name: "Finance",
      systemPrompt: "base prompt",
    });

    const node = createRuntimeAgentNode(baseModel, definition, [echoTool], {
      resolveModelForTurn: (_ctx, model) => ({ model, bindTools: true }),
    });

    const result = await node({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(bindToolsCalls).toHaveLength(1);
    expect(String(result.agentMessages?.[0]?.content)).toBe("bound model reply");
  });

  it("uses cached layout when useCachedPromptLayout is explicit even if bindTools stays true", async () => {
    let invokedMessages: unknown[] = [];
    const baseModel = {
      bindTools: () => ({
        invoke: async (messages: unknown[]) => {
          invokedMessages = messages;
          return new AIMessage("bound model reply");
        },
      }),
      invoke: async () => new AIMessage("base model should not be invoked directly"),
    } as unknown as BaseChatModel;

    const definition = makeTestRuntimeAgent({
      id: "finance",
      name: "Finance",
      systemPrompt: "base prompt",
    });

    const node = createRuntimeAgentNode(baseModel, definition, [echoTool], {
      resolveModelForTurn: (_ctx, model) => ({
        model,
        bindTools: true,
        useCachedPromptLayout: true,
      }),
      buildPromptMessages: (_ctx, systemPromptText, stateMessages) => [
        new HumanMessage(`<turn_context>${systemPromptText}</turn_context>`),
        ...stateMessages,
      ],
    });

    await node({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(invokedMessages[0]).toBeInstanceOf(HumanMessage);
    expect(String((invokedMessages[0] as HumanMessage).content)).toContain("<turn_context>");
  });

  it("uses the default SystemMessage prompt layout when buildPromptMessages is not provided", async () => {
    let invokedMessages: unknown[] = [];
    const baseModel = {
      bindTools: () => ({
        invoke: async (messages: unknown[]) => {
          invokedMessages = messages;
          return new AIMessage("reply");
        },
      }),
      invoke: async () => new AIMessage("unused"),
    } as unknown as BaseChatModel;

    const definition = makeTestRuntimeAgent({
      id: "obsidian",
      name: "Obsidian",
      systemPrompt: "base prompt",
    });

    const node = createRuntimeAgentNode(baseModel, definition, [echoTool]);

    await node({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(invokedMessages[0]).toBeInstanceOf(SystemMessage);
  });

  it("recovers from CachedContent 403 via recreate then uncached fallback", async () => {
    const bindToolsCalls: unknown[][] = [];
    let cachedInvokeCount = 0;
    let recoveredInvokeCount = 0;
    let boundInvokeCount = 0;
    let recoverCalls = 0;

    const recoveredModel = {
      invoke: async () => {
        recoveredInvokeCount += 1;
        throw Object.assign(
          new Error("[403 Forbidden] CachedContent not found (or permission denied)"),
          { status: 403 },
        );
      },
    } as unknown as BaseChatModel;

    const cachedModel = {
      invoke: async () => {
        cachedInvokeCount += 1;
        throw Object.assign(
          new Error("[403 Forbidden] CachedContent not found (or permission denied)"),
          { status: 403 },
        );
      },
    } as unknown as BaseChatModel;

    const boundModel = {
      invoke: async (messages: unknown[]) => {
        boundInvokeCount += 1;
        expect(messages[0]).toBeInstanceOf(SystemMessage);
        return new AIMessage("uncached recovery reply");
      },
    } as unknown as BaseChatModel;

    const baseModel = {
      bindTools: (...args: unknown[]) => {
        bindToolsCalls.push(args);
        return boundModel;
      },
      invoke: async () => new AIMessage("base model should not be invoked directly"),
    } as unknown as BaseChatModel;

    const definition = makeTestRuntimeAgent({
      id: "configuration",
      name: "Configuration",
      systemPrompt: "base prompt",
    });

    const node = createRuntimeAgentNode(baseModel, definition, [echoTool], {
      resolveModelForTurn: () => ({
        model: cachedModel,
        bindTools: false,
        useCachedPromptLayout: true,
        recoverFromCachedContentMiss: async () => {
          recoverCalls += 1;
          return {
            model: recoveredModel,
            bindTools: false,
            useCachedPromptLayout: true,
          };
        },
      }),
      buildSystemPrompt: (ctx) =>
        ctx.useCachedPromptLayout ? "dynamic only" : "static\n\ndynamic only",
      buildPromptMessages: (ctx, systemPromptText, stateMessages) => {
        if (ctx.useCachedPromptLayout) {
          return [
            new HumanMessage(`<turn_context>${systemPromptText}</turn_context>`),
            ...stateMessages,
          ];
        }

        return [new SystemMessage(systemPromptText), ...stateMessages];
      },
    });

    const result = await node({
      agentMessages: [new HumanMessage("hello")],
      stepCount: 0,
    });

    expect(recoverCalls).toBe(1);
    expect(cachedInvokeCount).toBe(1);
    expect(recoveredInvokeCount).toBe(1);
    expect(boundInvokeCount).toBe(1);
    expect(bindToolsCalls).toHaveLength(1);
    expect(String(result.agentMessages?.[0]?.content)).toBe("uncached recovery reply");
  });
});
