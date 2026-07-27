import { describe, expect, it } from "vitest";

import { deriveRuntimeAgentGraphFingerprint } from "../../src/framework/derive-agents.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";

const agent = (overrides: Partial<RuntimeAgentDefinition> = {}): RuntimeAgentDefinition => ({
  id: "finance",
  name: "Finance",
  description: "Finance",
  systemPrompt: "prompt",
  capabilityIds: ["finance-domain"],
  maxSteps: 8,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("deriveRuntimeAgentGraphFingerprint", () => {
  it("changes when a new enabled agent appears", () => {
    const before = deriveRuntimeAgentGraphFingerprint([agent()]);
    const after = deriveRuntimeAgentGraphFingerprint([
      agent(),
      agent({ id: "daily-summary", capabilityIds: ["none"] }),
    ]);

    expect(before).not.toBe(after);
  });

  it("changes when capabilities or max steps change", () => {
    const base = deriveRuntimeAgentGraphFingerprint([agent()]);
    const newCapabilities = deriveRuntimeAgentGraphFingerprint([
      agent({ capabilityIds: ["none", "finance-domain"] }),
    ]);
    const newSteps = deriveRuntimeAgentGraphFingerprint([agent({ maxSteps: 12 })]);

    expect(base).not.toBe(newCapabilities);
    expect(base).not.toBe(newSteps);
  });

  it("changes when model key changes", () => {
    const base = deriveRuntimeAgentGraphFingerprint([agent()]);
    const newModelKey = deriveRuntimeAgentGraphFingerprint([agent({ modelKey: "finance" })]);

    expect(base).not.toBe(newModelKey);
  });

  it("ignores disabled agents", () => {
    const enabledOnly = deriveRuntimeAgentGraphFingerprint([agent()]);
    const withDisabled = deriveRuntimeAgentGraphFingerprint([
      agent(),
      agent({ id: "disabled-agent", enabled: false, capabilityIds: ["none"] }),
    ]);

    expect(enabledOnly).toBe(withDisabled);
  });
});
