import { describe, expect, it } from "vitest";

import { createSystemAgentDefinition } from "../../src/framework/system-agent/definition.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";
import {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  normalizeSupervisorReply,
} from "../../src/core/supervisor/routing-schema.js";

const buildTestRuntimeAgents = (): RuntimeAgentDefinition[] => [
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

describe("supervisor routing schema", () => {
  it("normalizes placeholder reply strings to undefined", () => {
    expect(normalizeSupervisorReply("null")).toBeUndefined();
    expect(normalizeSupervisorReply(" NULL ")).toBeUndefined();
    expect(normalizeSupervisorReply("undefined")).toBeUndefined();
    expect(normalizeSupervisorReply("")).toBeUndefined();
    expect(normalizeSupervisorReply("  ")).toBeUndefined();
    expect(normalizeSupervisorReply("On it.")).toBe("On it.");
  });

  it("strips placeholder replies and unknown prompt fields during schema parsing", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({ next: "obsidian", prompt: "Show today's plan.", reply: "null" })).toEqual({
      next: "obsidian",
      queue: undefined,
      reply: undefined,
    });
  });

  it("accepts an ordered queue of agent ids", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({
      next: "finance",
      queue: [
        { agentId: "finance" },
        { agentId: "obsidian" },
      ],
    })).toEqual({
      next: "finance",
      queue: [
        { agentId: "finance" },
        { agentId: "obsidian" },
      ],
      reply: undefined,
    });
  });

  it("accepts a single-agent route without a specialist prompt", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({ next: "finance" })).toEqual({
      next: "finance",
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
    expect(() => schema.parse({ next: "configuration" })).toThrow();
    expect(schema.parse({ next: "finance" })).toEqual({
      next: "finance",
      queue: undefined,
      reply: undefined,
    });
  });
});
