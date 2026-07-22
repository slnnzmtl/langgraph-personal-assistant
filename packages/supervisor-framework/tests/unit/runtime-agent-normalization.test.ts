import { describe, expect, it } from "vitest";

import { normalizeRuntimeAgentDefinition } from "../../src/core/types/agent.js";

describe("runtime agent normalization", () => {
  it("preserves executor and modelKey in normalized definitions", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      id: "finance",
      name: "Finance",
      description: "Finance",
      systemPrompt: "Finance",
      promptSourceKey: "finance",
      capabilityIds: ["finance-domain"],
      executor: "finance",
      modelKey: "finance",
      builtin: false,
      maxSteps: 10,
      enabled: true,
      createdAt: "2026-07-20T10:33:00.659Z",
      updatedAt: "2026-07-15T21:31:53.713Z",
    });

    expect(normalized.executor).toBe("finance");
    expect(normalized.modelKey).toBe("finance");
    expect(normalized.capabilityIds).toEqual(["finance-domain"]);
  });
});
