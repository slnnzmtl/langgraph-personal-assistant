import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CONFIGURATION_PROMPT,
} from "../../../src/framework/defaults/default-configuration-prompt.js";
import { DEFAULT_CRON_SKILL_XML } from "../../../src/framework/defaults/default-cron-skill.js";
import { DEFAULT_SKILL_MANAGEMENT_SKILL_XML } from "../../../src/framework/defaults/default-skill-management-skill.js";
import { DEFAULT_SUPERVISOR_PROMPT } from "../../../src/framework/defaults/default-supervisor-prompt.js";
import { createDefaultContentSeeder } from "../../../src/framework/defaults/create-default-content-seeder.js";

describe("createDefaultContentSeeder", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("seeds missing prompts and configuration skills from framework defaults", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-${Date.now()}`);
    const promptsDir = path.join(tempRoot, "prompts");
    const skillsDir = path.join(tempRoot, "skills");
    const seeder = createDefaultContentSeeder({ promptsDir, skillsDir });

    seeder.seedAll();

    expect(readFileSync(path.join(promptsDir, "supervisor.xml"), "utf8")).toBe(
      DEFAULT_SUPERVISOR_PROMPT,
    );
    expect(readFileSync(path.join(promptsDir, "configuration.xml"), "utf8")).toBe(
      DEFAULT_CONFIGURATION_PROMPT,
    );
    expect(readFileSync(path.join(skillsDir, "cron.xml"), "utf8")).toBe(DEFAULT_CRON_SKILL_XML);
    expect(readFileSync(path.join(skillsDir, "runtime-agents.xml"), "utf8")).toContain(
      'name="runtime-agents"',
    );
    expect(readFileSync(path.join(skillsDir, "skill-management.xml"), "utf8")).toBe(
      DEFAULT_SKILL_MANAGEMENT_SKILL_XML,
    );
    expect(readFileSync(path.join(skillsDir, "skill-bootstrap.xml"), "utf8")).toContain(
      'name="skill-bootstrap"',
    );
  });

  it("creates target directories when they do not exist", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-mkdir-${Date.now()}`);
    const promptsDir = path.join(tempRoot, "nested", "prompts");
    const skillsDir = path.join(tempRoot, "nested", "skills");
    const seeder = createDefaultContentSeeder({ promptsDir, skillsDir });

    expect(existsSync(promptsDir)).toBe(false);
    expect(existsSync(skillsDir)).toBe(false);

    seeder.seedAll();

    expect(existsSync(promptsDir)).toBe(true);
    expect(existsSync(skillsDir)).toBe(true);
  });

  it("does not overwrite existing hand-authored files", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-no-overwrite-${Date.now()}`);
    const promptsDir = path.join(tempRoot, "prompts");
    const skillsDir = path.join(tempRoot, "skills");
    mkdirSync(promptsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    const customSupervisor = "<system_instructions>Custom supervisor</system_instructions>";
    const customSkillManagement = `<skill name="skill-management" module="configuration" description="Custom">
Valid modules: finance, obsidian, configuration.
</skill>`;

    writeFileSync(path.join(promptsDir, "supervisor.xml"), customSupervisor, "utf8");
    writeFileSync(path.join(skillsDir, "skill-management.xml"), customSkillManagement, "utf8");

    createDefaultContentSeeder({ promptsDir, skillsDir }).seedAll();

    expect(readFileSync(path.join(promptsDir, "supervisor.xml"), "utf8")).toBe(customSupervisor);
    expect(readFileSync(path.join(skillsDir, "skill-management.xml"), "utf8")).toBe(
      customSkillManagement,
    );
    expect(existsSync(path.join(promptsDir, "configuration.xml"))).toBe(true);
    expect(existsSync(path.join(skillsDir, "cron.xml"))).toBe(true);
  });

  it("is idempotent when called multiple times", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-idempotent-${Date.now()}`);
    const promptsDir = path.join(tempRoot, "prompts");
    const skillsDir = path.join(tempRoot, "skills");
    const seeder = createDefaultContentSeeder({ promptsDir, skillsDir });

    seeder.seedAll();
    const cronAfterFirst = readFileSync(path.join(skillsDir, "cron.xml"), "utf8");
    const supervisorAfterFirst = readFileSync(path.join(promptsDir, "supervisor.xml"), "utf8");

    seeder.seedAll();

    expect(readFileSync(path.join(skillsDir, "cron.xml"), "utf8")).toBe(cronAfterFirst);
    expect(readFileSync(path.join(promptsDir, "supervisor.xml"), "utf8")).toBe(supervisorAfterFirst);
  });

  it("invokes the optional logger only when a file is created", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-logger-${Date.now()}`);
    const promptsDir = path.join(tempRoot, "prompts");
    const skillsDir = path.join(tempRoot, "skills");
    const logger = vi.fn();
    const seeder = createDefaultContentSeeder({ promptsDir, skillsDir, logger });

    seeder.seedPrompts();
    seeder.seedPrompts();

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0]?.[0]).toContain("supervisor.xml");
    expect(logger.mock.calls[1]?.[0]).toContain("configuration.xml");
  });

  it("rethrows filesystem errors other than EEXIST", () => {
    tempRoot = path.join(os.tmpdir(), `default-content-seeder-error-${Date.now()}`);
    writeFileSync(tempRoot, "not-a-directory", "utf8");
    const promptsDir = path.join(tempRoot, "prompts");
    const skillsDir = path.join(tempRoot, "skills");
    const seeder = createDefaultContentSeeder({ promptsDir, skillsDir });

    expect(() => seeder.seedPrompts()).toThrow();
  });
});
