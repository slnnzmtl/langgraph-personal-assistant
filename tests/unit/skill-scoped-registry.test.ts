import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createGuardedToolNode } from "../../src/tools/guarded-tool-node.js";
import {
  createSkillScopedToolContextFromBundles,
  findUnauthorizedToolCalls,
  formatSkillToolsPreviewBlock,
  resolveActiveSkillFromHistory,
} from "../../src/tools/skill-scoped-registry.js";

const createTestReadSkillTool = () =>
  tool(async ({ name }: { name: string }) => `Loaded skill ${name}`, {
    name: "read_skill",
    description: "Load a skill",
    schema: z.object({ name: z.string() }),
  });

const createNamedTool = (name: string) =>
  tool(async () => `${name} ok`, {
    name,
    description: `${name} tool`,
    schema: z.object({}),
  });

describe("formatSkillToolsPreviewBlock", () => {
  it("formats registered bundle tools for read_skill output", () => {
    const block = formatSkillToolsPreviewBlock([
      createNamedTool("list_cron_jobs"),
      createNamedTool("create_cron_job"),
    ]);

    expect(block).toContain("<available_tools>");
    expect(block).toContain("- list_cron_jobs: list_cron_jobs tool");
    expect(block).toContain("- create_cron_job: create_cron_job tool");
  });

  it("returns undefined when a skill has no registered tools", () => {
    expect(formatSkillToolsPreviewBlock([])).toBeUndefined();
  });
});

describe("resolveActiveSkillFromHistory", () => {
  it("returns the most recent successful read_skill selection", () => {
    const active = resolveActiveSkillFromHistory([
      new HumanMessage("manage cron"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "cron body" }),
    ]);

    expect(active).toEqual({ skillName: "cron", args: { name: "cron" } });
  });

  it("ignores failed read_skill results", () => {
    const active = resolveActiveSkillFromHistory([
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "Error reading skill" }),
    ]);

    expect(active).toBeUndefined();
  });
});

describe("createSkillScopedToolContextFromBundles", () => {
  it("exposes only read_skill before a skill is loaded", () => {
    const context = createSkillScopedToolContextFromBundles({
      readSkillTool: createTestReadSkillTool(),
      bundles: {
        cron: [createNamedTool("list_cron_jobs")],
      },
    });

    const tools = context.resolveToolsForTurn([new HumanMessage("list cron jobs")]);
    expect(tools.map((tool) => tool.name)).toEqual(["read_skill"]);
  });

  it("exposes the active skill bundle after read_skill succeeds", () => {
    const context = createSkillScopedToolContextFromBundles({
      readSkillTool: createTestReadSkillTool(),
      bundles: {
        cron: [createNamedTool("list_cron_jobs"), createNamedTool("create_cron_job")],
      },
    });

    const tools = context.resolveToolsForTurn([
      new HumanMessage("schedule a job"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "cron" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "cron body" }),
    ]);

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_skill",
      "list_cron_jobs",
      "create_cron_job",
    ]);
  });

  it("includes default tools when no skill is active", () => {
    const context = createSkillScopedToolContextFromBundles({
      readSkillTool: createTestReadSkillTool(),
      bundles: {},
      defaultTools: [createNamedTool("read_file")],
    });

    const tools = context.resolveToolsForTurn([new HumanMessage("open note")]);
    expect(tools.map((tool) => tool.name)).toEqual(["read_skill", "read_file"]);
  });
});

describe("createGuardedToolNode", () => {
  it("rejects unauthorized tool calls before execution", async () => {
    const context = createSkillScopedToolContextFromBundles({
      readSkillTool: createTestReadSkillTool(),
      bundles: {
        cron: [createNamedTool("list_cron_jobs")],
      },
    });

    const guardedNode = createGuardedToolNode(context);
    const messages = [
      new HumanMessage("list cron jobs"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "list_cron_jobs", args: {}, id: "list-1", type: "tool_call" }],
      }),
    ];

    const unauthorized = findUnauthorizedToolCalls(
      messages,
      new Set(context.resolveToolsForTurn(messages).map((tool) => tool.name)),
    );
    expect(unauthorized).toEqual(["list_cron_jobs"]);

    const result = await guardedNode({ messages, stepCount: 0 });
    expect(result.messages?.[0]).toBeInstanceOf(ToolMessage);
    expect(String(result.messages?.[0]?.content)).toContain('Tool "list_cron_jobs" is not available');
  });
});
