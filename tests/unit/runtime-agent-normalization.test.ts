import { describe, expect, it } from "vitest";

import { normalizeRuntimeAgentDefinition, parseRuntimeAgentDefinition } from "../../src/core/types/agent.js";

describe("runtime agent normalization", () => {
  it("migrates legacy toolBundleIds-only persisted agents to capabilityIds on load", () => {
    const normalized = parseRuntimeAgentDefinition({
      id: "legacy-agent",
      name: "Legacy",
      description: "Legacy",
      systemPrompt: "Legacy",
      toolBundleIds: ["none"],
      executor: "generic",
      builtin: false,
      maxSteps: 4,
      enabled: true,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(normalized.capabilityIds).toEqual(["none"]);
    expect("toolBundleIds" in normalized).toBe(false);
  });

  it("preserves executor and modelKey without legacy migration in core normalize", () => {
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
    expect("toolBundleIds" in normalized).toBe(false);
  });
});
