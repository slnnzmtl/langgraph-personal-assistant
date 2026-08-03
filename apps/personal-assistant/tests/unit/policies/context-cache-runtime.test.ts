import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createSkillCatalog,
  type ContextCacheKit,
} from "@personal-assistant/supervisor-framework";

import { createContextCacheRuntimeConfig } from "../../../src/policies/context-cache-runtime.js";
import { createDefaultRuntimeShellFormatters } from "../../../src/composition/runtime-execution.js";
import { makeTestRuntimeAgent } from "../../helpers/fakes.js";

const echoTool = tool(async ({ text }: { text: string }) => text, {
  name: "echo",
  description: "Echo text back",
  schema: z.object({ text: z.string() }),
});

const makeTestCacheKit = (
  overrides: Partial<ContextCacheKit> = {},
): ContextCacheKit => ({
  cacheManager: {
    getOrCreate: async () => null,
    invalidate: () => undefined,
  },
  apiKey: "test-key",
  supervisorModelName: "gemini-2.5-flash-lite",
  resolveRuntimeModelName: () => "gemini-2.5-flash",
  createCachedModel: () => ({ invoke: async () => ({}) }) as never,
  ...overrides,
});

describe("createContextCacheRuntimeConfig", () => {
  it("resolves prompt parts once per turn across cache and prompt hooks", async () => {
    let extraSectionCalls = 0;
    const skillCatalog = createSkillCatalog({
      approvedModules: ["configuration", "finance", "obsidian"],
    });
    const shellFormatters = createDefaultRuntimeShellFormatters(skillCatalog);
    const definition = makeTestRuntimeAgent({
      id: "configuration",
      name: "Configuration",
      systemPrompt: "base prompt",
    });

    const cacheHooks = createContextCacheRuntimeConfig(makeTestCacheKit(), {
      modelName: "gemini-2.5-flash",
      skillCatalog,
      shellFormatters,
      displayName: "configuration-agent",
      resolveExtraDynamicSections: () => {
        extraSectionCalls += 1;
        return ["extra section"];
      },
    });

    const ctx = {
      basePrompt: "base prompt",
      definition,
      state: { agentMessages: [new HumanMessage("hello")] },
    } as never;

    await cacheHooks.resolveModelForTurn!(
      ctx,
      { bindTools: () => ({ invoke: async () => ({}) }) } as never,
      [echoTool],
    );
    await cacheHooks.buildSystemPrompt!(ctx);

    expect(extraSectionCalls).toBe(1);
  });

  it("returns explicit cached layout flags from resolveModelForTurn", async () => {
    const skillCatalog = createSkillCatalog({
      approvedModules: ["configuration"],
    });
    const shellFormatters = createDefaultRuntimeShellFormatters(skillCatalog);
    const definition = makeTestRuntimeAgent({
      id: "configuration",
      name: "Configuration",
      systemPrompt: "base prompt",
    });

    const ctx = {
      basePrompt: "base prompt",
      definition,
      state: { agentMessages: [new HumanMessage("hello")] },
    } as never;

    const hitHooks = createContextCacheRuntimeConfig(
      makeTestCacheKit({
        cacheManager: {
          getOrCreate: async () => ({
            cacheName: "cachedContents/test",
            model: "models/gemini-2.5-flash",
          }),
          invalidate: () => undefined,
        },
      }),
      {
        modelName: "gemini-2.5-flash",
        skillCatalog,
        shellFormatters,
        displayName: "configuration-agent",
      },
    );

    const hit = await hitHooks.resolveModelForTurn!(
      ctx,
      { bindTools: () => ({ invoke: async () => ({}) }) } as never,
      [echoTool],
    );

    expect(hit).toMatchObject({
      bindTools: false,
      useCachedPromptLayout: true,
    });
    expect(typeof hit.recoverFromCachedContentMiss).toBe("function");

    const missHooks = createContextCacheRuntimeConfig(makeTestCacheKit(), {
      modelName: "gemini-2.5-flash",
      skillCatalog,
      shellFormatters,
      displayName: "configuration-agent",
    });

    const missCtx = {
      basePrompt: "base prompt",
      definition,
      state: { agentMessages: [new HumanMessage("hello")] },
    } as never;

    const miss = await missHooks.resolveModelForTurn!(
      missCtx,
      { bindTools: () => ({ invoke: async () => ({}) }) } as never,
      [echoTool],
    );

    expect(miss).toMatchObject({
      bindTools: true,
      useCachedPromptLayout: false,
    });
  });
});
