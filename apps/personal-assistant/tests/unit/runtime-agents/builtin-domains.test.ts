import { describe, expect, it } from "vitest";

import {
  createSystemAgentDefinition,
  SYSTEM_AGENT_ID,
  buildSkillModuleOwnerPattern,
} from "@personal-assistant/supervisor-framework";
import {
  applyLocalModuleAvailability,
  resolveBuiltinModelName,
} from "../../../src/app/composition/bootstrap-agents.js";
import { listSkillModules } from "../../../src/runtime-agents/skills/skills-loader.js";
import { buildLocalModuleAgents } from "../../helpers/runtime-agent-fixtures.js";
import type { AppConfig } from "../../../src/config.js";

describe("system admin agent manifest", () => {
  it("defines the configuration system agent id for skill module continuity", () => {
    expect(SYSTEM_AGENT_ID).toBe("configuration");
    expect(listSkillModules()).toEqual(expect.arrayContaining(["finance", "obsidian", "configuration"]));
  });

  it("builds the system admin runtime agent from framework options", () => {
    const agent = createSystemAgentDefinition({
      modelKey: "configuration",
    });

    expect(agent.id).toBe("configuration");
    expect(agent.builtin).toBe(true);
    expect(agent.capabilityIds).toEqual(["system-config"]);
  });

  it("builds a skill module owner pattern from discovered modules", () => {
    const modules = listSkillModules();
    const pattern = buildSkillModuleOwnerPattern(modules);
    for (const module of modules) {
      expect(pattern.test(`${module} skills`)).toBe(true);
    }
  });

  it("disables finance-domain agents when Supabase is unavailable", () => {
    const financeAgent = buildLocalModuleAgents().find((agent) =>
      agent.capabilityIds.includes("finance-domain"),
    );

    expect(financeAgent).toBeDefined();
    expect(applyLocalModuleAvailability([financeAgent!], { supabaseAvailable: false })[0]?.enabled).toBe(false);
    expect(applyLocalModuleAvailability([financeAgent!], { supabaseAvailable: true })[0]?.enabled).toBe(true);
  });

  it("resolves model names from model key overrides", () => {
    const config = {
      geminiModel: "gemini-default",
      obsidianModel: "obsidian-model",
      financeModel: "finance-model",
      configurationModel: "configuration-model",
    } as AppConfig;

    expect(resolveBuiltinModelName(config, "generic")).toBe("gemini-default");
    expect(resolveBuiltinModelName(config, "finance")).toBe("finance-model");
    expect(resolveBuiltinModelName(config, "obsidian")).toBe("obsidian-model");
    expect(resolveBuiltinModelName(config, "configuration")).toBe("configuration-model");
    expect(resolveBuiltinModelName(config, "unknown")).toBe("gemini-default");
  });
});
