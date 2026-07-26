import { describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_EXECUTOR,
  SYSTEM_AGENT_EXECUTOR,
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
  it("routes product agents to the default generic policy regardless of stored executor", () => {
    expect(resolveRuntimeAgentPolicyExecutor(baseAgent({ executor: "generic" }))).toBe(
      DEFAULT_RUNTIME_EXECUTOR,
    );
    expect(resolveRuntimeAgentPolicyExecutor(baseAgent({ executor: "obsidian" }))).toBe(
      DEFAULT_RUNTIME_EXECUTOR,
    );
    expect(resolveRuntimeAgentPolicyExecutor(baseAgent({ executor: "finance" }))).toBe(
      DEFAULT_RUNTIME_EXECUTOR,
    );
  });

  it("routes the system configuration agent to the configuration policy", () => {
    expect(
      resolveRuntimeAgentPolicyExecutor(
        baseAgent({ id: SYSTEM_AGENT_EXECUTOR, executor: SYSTEM_AGENT_EXECUTOR }),
      ),
    ).toBe(SYSTEM_AGENT_EXECUTOR);
    expect(
      resolveRuntimeAgentPolicyExecutor(
        baseAgent({ id: "other", executor: SYSTEM_AGENT_EXECUTOR }),
      ),
    ).toBe(SYSTEM_AGENT_EXECUTOR);
  });
});
