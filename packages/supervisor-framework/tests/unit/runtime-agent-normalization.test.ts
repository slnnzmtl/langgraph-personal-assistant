import { describe, expect, it } from "vitest";

import {
  CONFIGURATION_AGENT_ID,
  DEFAULT_PRODUCT_EXECUTOR,
  normalizeRuntimeAgentDefinition,
  resolveAgentModelKey,
} from "../../src/core/types/agent.js";

const baseInput = {
  name: "Finance",
  description: "Finance",
  systemPrompt: "Finance",
  capabilityIds: ["finance-domain"],
  builtin: false,
  maxSteps: 10,
  enabled: true,
  createdAt: "2026-07-20T10:33:00.659Z",
  updatedAt: "2026-07-15T21:31:53.713Z",
};

describe("runtime agent normalization", () => {
  it("coerces legacy finance executor to generic while preserving modelKey", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "finance",
      promptSourceKey: "finance",
      executor: "finance",
      modelKey: "finance",
    });

    expect(normalized.executor).toBe(DEFAULT_PRODUCT_EXECUTOR);
    expect(normalized.modelKey).toBe("finance");
  });

  it("infers modelKey from legacy executor when modelKey is absent", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "obsidian",
      promptSourceKey: "obsidian",
      capabilityIds: ["obsidian-vault"],
      executor: "obsidian",
    });

    expect(normalized.executor).toBe(DEFAULT_PRODUCT_EXECUTOR);
    expect(normalized.modelKey).toBe("obsidian");
  });

  it("keeps configuration as the only non-generic executor", () => {
    const normalized = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: CONFIGURATION_AGENT_ID,
      capabilityIds: ["system-config"],
      executor: CONFIGURATION_AGENT_ID,
      modelKey: "configuration",
      builtin: true,
    });

    expect(normalized.executor).toBe(CONFIGURATION_AGENT_ID);
    expect(normalized.modelKey).toBe("configuration");
  });

  it("resolves model keys from modelKey only", () => {
    const agent = normalizeRuntimeAgentDefinition({
      ...baseInput,
      id: "finance",
      executor: "finance",
      modelKey: "finance",
    });

    expect(resolveAgentModelKey(agent)).toBe("finance");
    expect(resolveAgentModelKey(
      normalizeRuntimeAgentDefinition({
        ...baseInput,
        id: "coder",
        capabilityIds: ["none"],
        executor: "generic",
      }),
    )).toBe(DEFAULT_PRODUCT_EXECUTOR);
  });
});
