import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_KEY,
  normalizeRuntimeAgentDefinition,
  resolveAgentModelKey,
  SYSTEM_AGENT_ID,
} from "../../src/core/types/agent.js";

const baseInput = {
  name: "Finance",
  description: "Finance",
  systemPrompt: "Finance",
  capabilityIds: ["finance-domain"],
  maxSteps: 10,
  enabled: true,
  createdAt: "2026-07-20T10:33:00.659Z",
  updatedAt: "2026-07-15T21:31:53.713Z",
};

describe("runtime agent normalization", () => {
  it("preserves modelKey when present", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "finance",
      promptSourceKey: "finance",
      modelKey: "finance",
    });

    expect(normalized.modelKey).toBe("finance");
  });

  it("omits modelKey when absent", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "finance",
    });

    expect(normalized.modelKey).toBeUndefined();
  });

  it("preserves system agent modelKey when present", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: SYSTEM_AGENT_ID,
      capabilityIds: ["system-config"],
      modelKey: SYSTEM_AGENT_ID,
    });

    expect(normalized.modelKey).toBe(SYSTEM_AGENT_ID);
  });

  it("resolves model keys from modelKey only", () => {
    const agent = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "finance",
      modelKey: "finance",
    });

    expect(resolveAgentModelKey(agent)).toBe("finance");
    expect(resolveAgentModelKey(
      normalizeRuntimeAgentDefinition({
        ...baseInput,
        id: "coder",
        capabilityIds: ["none"],
      }),
    )).toBe(DEFAULT_MODEL_KEY);
  });
});
