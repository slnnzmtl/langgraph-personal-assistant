import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_CONFIGURATION_PROMPT,
  DEFAULT_CRON_SKILL_XML,
  DEFAULT_RUNTIME_AGENTS_SKILL_XML,
  DEFAULT_SKILL_BOOTSTRAP_SKILL_XML,
  DEFAULT_SKILL_MANAGEMENT_SKILL_XML,
  DEFAULT_SUPERVISOR_PROMPT
} from "./index.js";

export type DefaultContentSeederOptions = {
  promptsDir: string;
  skillsDir: string;
  logger?: (message: string) => void;
};

export type DefaultContentSeeder = {
  seedPrompts: () => void;
  seedConfigurationSkills: () => void;
  seedAll: () => void;
};

const writeIfMissing = (
  targetDir: string,
  fileName: string,
  content: string,
  logger?: DefaultContentSeederOptions["logger"],
): void => {
  const target = path.join(targetDir, fileName);
  try {
    writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return;
    }

    throw error;
  }

  logger?.(`Seeded missing file with generic default: ${target}`);
};

export const createDefaultContentSeeder = (
  options: DefaultContentSeederOptions,
): DefaultContentSeeder => {
  const { promptsDir, skillsDir, logger } = options;

  const seedPrompts = (): void => {
    mkdirSync(promptsDir, { recursive: true });
    writeIfMissing(promptsDir, "supervisor.xml", DEFAULT_SUPERVISOR_PROMPT, logger);
    writeIfMissing(promptsDir, "configuration.xml", DEFAULT_CONFIGURATION_PROMPT, logger);
  };

  const seedConfigurationSkills = (): void => {
    mkdirSync(skillsDir, { recursive: true });
    writeIfMissing(skillsDir, "cron.xml", DEFAULT_CRON_SKILL_XML, logger);
    writeIfMissing(skillsDir, "runtime-agents.xml", DEFAULT_RUNTIME_AGENTS_SKILL_XML, logger);
    writeIfMissing(skillsDir, "skill-management.xml", DEFAULT_SKILL_MANAGEMENT_SKILL_XML, logger);
    writeIfMissing(skillsDir, "skill-bootstrap.xml", DEFAULT_SKILL_BOOTSTRAP_SKILL_XML, logger);
  };

  const seedAll = (): void => {
    seedPrompts();
    seedConfigurationSkills();
  };

  return {
    seedPrompts,
    seedConfigurationSkills,
    seedAll,
  };
};
