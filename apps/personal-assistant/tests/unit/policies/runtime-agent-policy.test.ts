import { describe, expect, it } from "vitest";

import { hasObsidianVaultCapability } from "../../../src/policies/runtime-agent-policy.js";
import { buildLocalModuleAgents } from "../../helpers/runtime-agent-fixtures.js";

describe("hasObsidianVaultCapability", () => {
  it("returns true when obsidian-vault is granted", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian");
    expect(obsidian).toBeDefined();
    expect(hasObsidianVaultCapability(obsidian!)).toBe(true);
  });

  it("returns false for finance-only agents", () => {
    const finance = buildLocalModuleAgents().find((agent) => agent.id === "finance");
    expect(finance).toBeDefined();
    expect(hasObsidianVaultCapability(finance!)).toBe(false);
  });
});
