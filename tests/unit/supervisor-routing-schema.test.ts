import { describe, expect, it } from "vitest";

import {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  normalizeDelegationPrompt,
  normalizeSupervisorReply,
} from "../../src/core/supervisor/routing-schema.js";
import { buildTestRuntimeAgents } from "../helpers/runtime-agent-fixtures.js";

describe("supervisor routing schema", () => {
  it("normalizes placeholder reply strings to undefined", () => {
    expect(normalizeSupervisorReply("null")).toBeUndefined();
    expect(normalizeSupervisorReply(" NULL ")).toBeUndefined();
    expect(normalizeSupervisorReply("undefined")).toBeUndefined();
    expect(normalizeSupervisorReply("")).toBeUndefined();
    expect(normalizeSupervisorReply("  ")).toBeUndefined();
    expect(normalizeSupervisorReply("On it.")).toBe("On it.");
  });

  it("normalizes empty delegation prompts to undefined", () => {
    expect(normalizeDelegationPrompt("")).toBeUndefined();
    expect(normalizeDelegationPrompt("  ")).toBeUndefined();
    expect(normalizeDelegationPrompt("Show expenses.")).toBe("Show expenses.");
  });

  it("strips placeholder replies during schema parsing", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({ next: "obsidian", prompt: "Show today's plan.", reply: "null" })).toEqual({
      next: "obsidian",
      prompt: "Show today's plan.",
      queue: undefined,
      reply: undefined,
    });
  });

  it("accepts an ordered queue of execution steps", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({
      next: "finance",
      queue: [
        { agentId: "finance", prompt: "Show yesterday's expenses." },
        { agentId: "obsidian", prompt: "Show today's plan." },
      ],
    })).toEqual({
      next: "finance",
      prompt: undefined,
      queue: [
        { agentId: "finance", prompt: "Show yesterday's expenses." },
        { agentId: "obsidian", prompt: "Show today's plan." },
      ],
      reply: undefined,
    });
  });

  it("accepts a single-agent route with prompt", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({ next: "finance", prompt: "Log lunch expense." })).toEqual({
      next: "finance",
      prompt: "Log lunch expense.",
      queue: undefined,
      reply: undefined,
    });
  });

  it("excludes enabled agents that are not wired into the compiled graph", () => {
    const agents = buildTestRuntimeAgents();
    const wiredAgentIds = new Set(["finance", "obsidian"]);

    const routable = filterRoutableRuntimeAgents(agents, wiredAgentIds);
    expect(routable.map((agent) => agent.id)).not.toContain("configuration");

    const schema = buildSupervisorRoutingSchema(agents, wiredAgentIds);
    expect(() => schema.parse({ next: "configuration", prompt: "Schedule a job." })).toThrow();
    expect(schema.parse({ next: "finance", prompt: "Show finances." })).toEqual({
      next: "finance",
      prompt: "Show finances.",
      queue: undefined,
      reply: undefined,
    });
  });
});
