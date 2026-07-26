import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  createRuntimeShellHooks,
  normalizeRuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import {
  applyLocalModuleAvailability,
} from "../../src/app/composition/bootstrap-agents.js";
import {
  createDefaultRuntimeShellFormatters,
} from "../../src/app/register-defaults.js";
import {
  createDefaultRuntimeAgentPolicy,
  hasObsidianVaultCapability,
} from "../../src/app/policies/generic-runtime-policy.js";
import { createPersonalCapabilityProviders } from "../../src/runtime-agents/builtin-capabilities.js";
import { createPersonalResolveTools } from "../../src/app/composition/personal-resolve-tools.js";
import { buildLocalModuleAgents } from "../helpers/runtime-agent-fixtures.js";

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

describe("createDefaultRuntimeAgentPolicy", () => {
  it("creates a runtime agent policy with graph bundle factory", () => {
    const catalog = createCapabilityCatalog(createPersonalCapabilityProviders() as never);
    const shellFormatters = createDefaultRuntimeShellFormatters();
    const shellHooks = createRuntimeShellHooks(shellFormatters);
    const policy = createDefaultRuntimeAgentPolicy(shellHooks, {
      capabilityCatalog: catalog,
      resolveTools: createPersonalResolveTools(catalog),
      shellFormatters,
    });

    expect(typeof policy.createGraphBundle).toBe("function");
  });
});

describe("applyLocalModuleAvailability", () => {
  it("disables finance agents when Supabase is unavailable", () => {
    const finance = buildLocalModuleAgents().find((agent) => agent.id === "finance")!;

    const [updated] = applyLocalModuleAvailability([finance], { supabaseAvailable: false });

    expect(updated?.enabled).toBe(false);
  });

  it("leaves agents enabled when Supabase is available", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian")!;
    const legacyInput = {
      ...obsidian,
      executor: "obsidian",
    };
    const normalized = normalizeRuntimeAgentDefinition(legacyInput);

    const [updated] = applyLocalModuleAvailability([normalized], { supabaseAvailable: true });

    expect(updated?.executor).toBe("generic");
    expect(updated?.enabled).toBe(true);
  });
});
