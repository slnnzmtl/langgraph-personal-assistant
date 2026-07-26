import { describe, expect, it } from "vitest";

import {
  createCapabilityCatalog,
  createRuntimeShellHooks,
  type RuntimeAgentDefinition,
} from "@personal-assistant/supervisor-framework";
import {
  applyLocalModuleAvailability,
  normalizeLegacyExecutors,
} from "../../src/app/composition/bootstrap-agents.js";
import {
  createDefaultRuntimeShellFormatters,
} from "../../src/app/register-defaults.js";
import {
  createGenericRuntimeAgentPolicy,
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

describe("normalizeLegacyExecutors", () => {
  it("maps legacy obsidian executor to generic when obsidian-vault is granted", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian")!;
    const legacyAgent: RuntimeAgentDefinition = { ...obsidian, executor: "obsidian" };

    const [normalized] = normalizeLegacyExecutors([legacyAgent]);

    expect(normalized?.executor).toBe("generic");
  });

  it("leaves unrelated executors unchanged", () => {
    const agent: RuntimeAgentDefinition = {
      ...buildLocalModuleAgents()[0]!,
      id: "custom",
      executor: "custom-domain",
      capabilityIds: ["none"],
    };

    const [normalized] = normalizeLegacyExecutors([agent]);

    expect(normalized?.executor).toBe("custom-domain");
  });
});

describe("createGenericRuntimeAgentPolicy", () => {
  it("registers a single generic executor policy", () => {
    const catalog = createCapabilityCatalog(createPersonalCapabilityProviders() as never);
    const shellFormatters = createDefaultRuntimeShellFormatters();
    const shellHooks = createRuntimeShellHooks(shellFormatters);
    const policy = createGenericRuntimeAgentPolicy(shellHooks, {
      capabilityCatalog: catalog,
      resolveTools: createPersonalResolveTools(catalog),
      shellFormatters,
    });

    expect(policy.executor).toBe("generic");
  });
});

describe("applyLocalModuleAvailability", () => {
  it("normalizes legacy obsidian executors before availability checks", () => {
    const obsidian = buildLocalModuleAgents().find((agent) => agent.id === "obsidian")!;
    const legacyAgent: RuntimeAgentDefinition = { ...obsidian, executor: "obsidian" };

    const [normalized] = applyLocalModuleAvailability([legacyAgent], { supabaseAvailable: true });

    expect(normalized?.executor).toBe("generic");
    expect(normalized?.enabled).toBe(true);
  });
});
