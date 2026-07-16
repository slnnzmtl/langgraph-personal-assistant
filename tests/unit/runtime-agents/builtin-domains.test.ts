import { describe, expect, it } from "vitest";

import {
  BUILTIN_DOMAIN_IDS,
  BUILTIN_DOMAIN_SPECS,
  applyBuiltinDomainAvailability,
  buildDefaultRuntimeAgents,
  resolveBuiltinModelName,
} from "../../../src/runtime-agents/builtin-domains.js";
import type { AppConfig } from "../../../src/config.js";

describe("builtin domain manifest", () => {
  it("defines the built-in finance, obsidian, and configuration domains", () => {
    expect(BUILTIN_DOMAIN_IDS).toEqual(["finance", "obsidian", "configuration"]);
    expect(BUILTIN_DOMAIN_SPECS.map((spec) => spec.executor)).toEqual(BUILTIN_DOMAIN_IDS);
  });

  it("builds default runtime agents from the manifest", () => {
    const agents = buildDefaultRuntimeAgents();

    expect(agents).toHaveLength(3);
    expect(agents.map((agent) => agent.id)).toEqual(BUILTIN_DOMAIN_IDS);
    expect(agents.every((agent) => agent.builtin === true)).toBe(true);
  });

  it("disables finance when Supabase is unavailable", () => {
    const financeAgent = buildDefaultRuntimeAgents().find((agent) => agent.id === "finance");

    expect(financeAgent).toBeDefined();
    expect(applyBuiltinDomainAvailability(financeAgent!, { financeAvailable: false }).enabled).toBe(false);
    expect(applyBuiltinDomainAvailability(financeAgent!, { financeAvailable: true }).enabled).toBe(true);
  });

  it("resolves model names from manifest config keys", () => {
    const config = {
      geminiModel: "gemini-default",
      obsidianModel: "obsidian-model",
      financeModel: "finance-model",
      configurationModel: "configuration-model",
    } as AppConfig;

    expect(resolveBuiltinModelName(config, "generic")).toBe("obsidian-model");
    expect(resolveBuiltinModelName(config, "finance")).toBe("finance-model");
    expect(resolveBuiltinModelName(config, "obsidian")).toBe("obsidian-model");
    expect(resolveBuiltinModelName(config, "configuration")).toBe("configuration-model");
    expect(resolveBuiltinModelName(config, "unknown")).toBe("gemini-default");
  });
});
