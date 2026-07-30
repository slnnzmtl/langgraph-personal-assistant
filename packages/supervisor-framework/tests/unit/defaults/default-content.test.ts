import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIGURATION_PROMPT,
  DEFAULT_CRON_SKILL_XML,
  DEFAULT_RUNTIME_AGENTS_SKILL_XML,
  DEFAULT_SKILL_BOOTSTRAP_SKILL_XML,
  DEFAULT_SKILL_MANAGEMENT_SKILL_XML,
  DEFAULT_SUPERVISOR_PROMPT,
} from "../../../src/framework/defaults/content/index.js";

const ALL_DEFAULTS = [
  DEFAULT_SUPERVISOR_PROMPT,
  DEFAULT_CONFIGURATION_PROMPT,
  DEFAULT_CRON_SKILL_XML,
  DEFAULT_RUNTIME_AGENTS_SKILL_XML,
  DEFAULT_SKILL_MANAGEMENT_SKILL_XML,
  DEFAULT_SKILL_BOOTSTRAP_SKILL_XML,
] as const;

describe("framework default content", () => {
  it("contains no hardcoded finance or obsidian domain references", () => {
    for (const content of ALL_DEFAULTS) {
      expect(content.toLowerCase()).not.toContain("finance");
      expect(content.toLowerCase()).not.toContain("obsidian");
    }
  });

  it("provides a minimal supervisor prompt routing to FINISH and configuration", () => {
    expect(DEFAULT_SUPERVISOR_PROMPT).toContain('node="FINISH"');
    expect(DEFAULT_SUPERVISOR_PROMPT).toContain('node="configuration"');
    expect(DEFAULT_SUPERVISOR_PROMPT).toContain('"next": "FINISH | configuration"');
  });

  it("provides a configuration prompt referencing cron, runtime-agents, and skill tools", () => {
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("Configuration Manager");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("`cron` skill");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("`runtime-agents` skill");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("`skill-management` exactly");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("`skill-bootstrap` exactly");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("restore");
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("<output_templates>");
  });

  it("documents restore-as-create in the configuration prompt", () => {
    expect(DEFAULT_CONFIGURATION_PROMPT).toContain("Deleted skills cannot be recovered");
  });

  it("provides a cron skill that resolves targets via list_runtime_agents", () => {
    expect(DEFAULT_CRON_SKILL_XML).toContain('name="cron"');
    expect(DEFAULT_CRON_SKILL_XML).toContain("list_cron_jobs()");
    expect(DEFAULT_CRON_SKILL_XML).toContain("list_runtime_agents()");
    expect(DEFAULT_CRON_SKILL_XML).not.toContain("Valid target routes");
  });

  it("provides a runtime-agents skill with generic CRUD routing", () => {
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).toContain('name="runtime-agents"');
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).toContain("list_runtime_agents");
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).toContain("create_runtime_agent");
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).toContain("delete_runtime_agent");
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).toContain("configured prompt store");
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).not.toContain("Docker-persisted");
    expect(DEFAULT_RUNTIME_AGENTS_SKILL_XML).not.toContain("data/prompts");
  });

  it("provides a skill-management skill with dynamic module resolution", () => {
    expect(DEFAULT_SKILL_MANAGEMENT_SKILL_XML).toContain('name="skill-management"');
    expect(DEFAULT_SKILL_MANAGEMENT_SKILL_XML).toContain("list_runtime_agents");
    expect(DEFAULT_SKILL_MANAGEMENT_SKILL_XML).toContain("list_skills(module)");
    expect(DEFAULT_SKILL_MANAGEMENT_SKILL_XML).toContain('read_skill("skill-bootstrap")');
  });

  it("provides a skill-bootstrap skill with dynamic owner inference", () => {
    expect(DEFAULT_SKILL_BOOTSTRAP_SKILL_XML).toContain('name="skill-bootstrap"');
    expect(DEFAULT_SKILL_BOOTSTRAP_SKILL_XML).toContain("list_runtime_agents");
    expect(DEFAULT_SKILL_BOOTSTRAP_SKILL_XML).toContain("list_capabilities");
    expect(DEFAULT_SKILL_BOOTSTRAP_SKILL_XML).toContain("create_skill(module, name, description, content)");
  });
});
