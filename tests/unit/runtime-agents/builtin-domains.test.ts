import { describe, expect, it } from "vitest";

import {
  BUILTIN_DOMAIN_IDS,
  BUILTIN_DOMAIN_SPECS,
  CONFIGURATOR_AGENT_ID,
  CONFIGURATOR_SPEC,
  applyLocalModuleAvailability,
  buildDefaultRuntimeAgents,
  buildSkillModuleOwnerPattern,
  resolveBuiltinModelName,
} from "../../../src/runtime-agents/builtin-domains.js";
import { listSkillModules } from "../../../src/prompts/skills-loader.js";
import { buildLocalModuleAgents } from "../../helpers/runtime-agent-fixtures.js";
import type { AppConfig } from "../../../src/config.js";

describe("configurator manifest", () => {
  it("defines only the core configuration agent as built-in", () => {
    expect(BUILTIN_DOMAIN_IDS).toEqual([CONFIGURATOR_AGENT_ID]);
    expect(BUILTIN_DOMAIN_SPECS).toEqual([CONFIGURATOR_SPEC]);
    expect(listSkillModules()).toEqual(expect.arrayContaining(["finance", "obsidian", "configuration"]));
  });

  it("builds the configurator runtime agent from the manifest", () => {
    const agents = buildDefaultRuntimeAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(CONFIGURATOR_AGENT_ID);
    expect(agents.every((agent) => agent.builtin === true)).toBe(true);
  });

  it("builds a skill module owner pattern from discovered modules", () => {
    const pattern = buildSkillModuleOwnerPattern();
    for (const module of listSkillModules()) {
      expect(pattern.test(`${module} skills`)).toBe(true);
    }
  });

  it("disables finance-domain agents when Supabase is unavailable", () => {
    const financeAgent = buildLocalModuleAgents().find((agent) =>
      agent.toolBundleIds.includes("finance-domain"),
    );

    expect(financeAgent).toBeDefined();
    expect(applyLocalModuleAvailability([financeAgent!], { supabaseAvailable: false })[0]?.enabled).toBe(false);
    expect(applyLocalModuleAvailability([financeAgent!], { supabaseAvailable: true })[0]?.enabled).toBe(true);
  });

  it("resolves model names from executor config keys", () => {
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
