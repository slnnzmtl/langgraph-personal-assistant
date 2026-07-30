import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  SYSTEM_CONFIG_CAPABILITY_ID,
} from "@personal-assistant/supervisor-framework";
import { resolveCapabilityHookId } from "../../../src/policies/runtime-agent-policy.js";
import { resolvePersonalCapabilityHookId } from "../../../src/composition/personal-runtime-policy.js";
import { OBSIDIAN_VAULT_CAPABILITY_ID } from "../../../src/runtime-agents/obsidian/tools.js";
import { buildLocalModuleAgents } from "../../helpers/runtime-agent-fixtures.js";

describe("resolveCapabilityHookId", () => {
  it("selects system-config for the configuration agent", () => {
    expect(
      resolveCapabilityHookId(createSystemAgentDefinition({ modelKey: "configuration" })),
    ).toBe(SYSTEM_CONFIG_CAPABILITY_ID);
  });

  it("returns undefined for product agents (no policy-owned product hooks)", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian");
    const finance = buildLocalModuleAgents().find((agent) => agent.id === "finance");
    expect(obsidian).toBeDefined();
    expect(finance).toBeDefined();
    expect(resolveCapabilityHookId(obsidian!)).toBeUndefined();
    expect(resolveCapabilityHookId(finance!)).toBeUndefined();
  });
});

describe("resolvePersonalCapabilityHookId", () => {
  it("selects system-config for the configuration agent", () => {
    expect(
      resolvePersonalCapabilityHookId(
        createSystemAgentDefinition({ modelKey: "configuration" }),
        "/tmp/vault",
      ),
    ).toBe(SYSTEM_CONFIG_CAPABILITY_ID);
  });

  it("selects obsidian-vault for the obsidian agent when vault is closed over", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian");
    expect(obsidian).toBeDefined();
    expect(resolvePersonalCapabilityHookId(obsidian!, "/tmp/vault")).toBe(OBSIDIAN_VAULT_CAPABILITY_ID);
    expect(resolvePersonalCapabilityHookId(obsidian!, undefined)).toBeUndefined();
  });

  it("returns undefined for tools-only finance agents", () => {
    const finance = buildLocalModuleAgents().find((agent) => agent.id === "finance");
    expect(finance).toBeDefined();
    expect(resolvePersonalCapabilityHookId(finance!, "/tmp/vault")).toBeUndefined();
  });
});
