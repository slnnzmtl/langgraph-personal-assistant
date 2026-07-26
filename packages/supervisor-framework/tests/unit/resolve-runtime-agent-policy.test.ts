import { describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_EXECUTOR,
  resolveRuntimeAgentPolicyExecutor,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";

const baseAgent = (overrides: Partial<RuntimeAgentDefinition> = {}): RuntimeAgentDefinition => ({
  id: "researcher",
  name: "Researcher",
  description: "Test agent.",
  systemPrompt: "You are a test agent.",
  capabilityIds: ["none"],
  executor: "generic",
  builtin: false,
  maxSteps: 6,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("resolveRuntimeAgentPolicyExecutor", () => {
  it("routes every runtime agent to the single default policy", () => {
    expect(resolveRuntimeAgentPolicyExecutor(baseAgent({ executor: "generic" }))).toBe(
      DEFAULT_RUNTIME_EXECUTOR,
    );
    expect(resolveRuntimeAgentPolicyExecutor(baseAgent({ executor: "obsidian" }))).toBe(
      DEFAULT_RUNTIME_EXECUTOR,
    );
    expect(
      resolveRuntimeAgentPolicyExecutor(
        baseAgent({ id: "configuration", executor: "configuration", capabilityIds: ["system-config"] }),
      ),
    ).toBe(DEFAULT_RUNTIME_EXECUTOR);
  });
});
