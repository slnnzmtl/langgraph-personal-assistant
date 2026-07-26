import { describe, expect, it } from "vitest";

import {
  hasSystemConfigWriteCapability,
  SYSTEM_CONFIG_CAPABILITY_ID,
} from "../../src/framework/system-agent/system-config-hooks.js";
import { isSystemAgentId } from "../../src/framework/system-agent/definition.js";
import type { RuntimeAgentDefinition } from "../../src/core/types/agent.js";

const agent = (overrides: Partial<RuntimeAgentDefinition> = {}): RuntimeAgentDefinition => ({
  id: "researcher",
  name: "Researcher",
  description: "Test",
  systemPrompt: "Test",
  capabilityIds: ["none"],
  executor: "generic",
  builtin: false,
  maxSteps: 8,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("hasSystemConfigWriteCapability", () => {
  it("matches the virtual configuration agent", () => {
    expect(
      hasSystemConfigWriteCapability(
        agent({ id: "configuration", capabilityIds: [SYSTEM_CONFIG_CAPABILITY_ID] }),
      ),
    ).toBe(true);
    expect(isSystemAgentId("configuration")).toBe(true);
  });

  it("does not match read-only or product agents", () => {
    expect(hasSystemConfigWriteCapability(agent({ capabilityIds: ["system-config-read"] }))).toBe(false);
    expect(hasSystemConfigWriteCapability(agent({ capabilityIds: ["finance-domain"] }))).toBe(false);
  });
});
