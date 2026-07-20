import { describe, expect, it } from "vitest";

import { buildSupervisorRoutingSchema, normalizeSupervisorReply } from "../../src/core/supervisor/routing-schema.js";
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

  it("strips placeholder replies during schema parsing", () => {
    const schema = buildSupervisorRoutingSchema(buildTestRuntimeAgents());

    expect(schema.parse({ next: "obsidian", reply: "null" })).toEqual({
      next: "obsidian",
      reply: undefined,
    });
  });
});
