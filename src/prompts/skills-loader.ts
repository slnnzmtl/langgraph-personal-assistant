import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Metadata extracted from a skill file's frontmatter.
 */
export interface SkillMeta {
  name: string;
  description: string;
  fileName: string;
}

export type SkillDisplayStatus = "Created" | "Updated" | "Deleted" | "Listed" | "Previewed" | "Read";

/**
 * Result of parsing frontmatter from raw markdown.
 */
interface FrontmatterResult {
  data: Record<string, string>;
  body: string;
}

/**
 * Parse a leading YAML frontmatter block (---\nkey: value\n---).
 * Returns { data, body } where data contains parsed key/value pairs.
 * If no frontmatter found, returns { data: {}, body: raw content }.
 */
export const parseFrontmatter = (raw: string): FrontmatterResult => {
  const lines = raw.split("\n");
  
  if (!lines[0]?.startsWith("---")) {
    return { data: {}, body: raw };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.startsWith("---")) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { data: {}, body: raw };
  }

  const fmLines = lines.slice(1, endIdx);
  const data: Record<string, string> = {};

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > -1) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();
      if (key && value) {
        data[key] = value;
      }
    }
  }

  const body = lines.slice(endIdx + 1).join("\n").trim();
  return { data, body };
};

/**
 * List all skills in a directory by reading and parsing frontmatter.
 * Returns SkillMeta[] sorted by name. Warns and skips files without name/description.
 * Returns [] if directory does not exist.
 */
export const listSkills = (skillsDir: string): SkillMeta[] => {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const files = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  const skills: SkillMeta[] = [];

  for (const fileName of files) {
    try {
      const content = readFileSync(path.join(skillsDir, fileName), "utf8");
      const { data } = parseFrontmatter(content);

      if (!data.name || !data.description) {
        console.warn(
          `Skill file ${fileName} missing 'name' or 'description' frontmatter; skipping.`
        );
        continue;
      }

      skills.push({
        name: data.name,
        description: data.description,
        fileName,
      });
    } catch (error) {
      console.warn(`Failed to parse skill file ${fileName}:`, error);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
};

export interface ResolvedSkill {
  meta: SkillMeta;
  filePath: string;
}

const assertPathWithinDir = (filePath: string, dir: string): string => {
  const resolved = path.resolve(filePath);
  const dirResolved = path.resolve(dir);

  if (!resolved.startsWith(dirResolved)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  return resolved;
};

const validateSkillFields = (name: string, description: string): void => {
  if (!name.trim()) {
    throw new Error("Skill name is required.");
  }

  if (!description.trim()) {
    throw new Error("Skill description is required.");
  }
};

/**
 * Find a skill by frontmatter name (case-insensitive) or filename.
 * Path-safe: ensures resolved path stays within skillsDir.
 * Throws on not found or path traversal attempt.
 */
export const resolveSkillMeta = (skillsDir: string, name: string): ResolvedSkill => {
  const skills = listSkills(skillsDir);

  const byName = skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
  if (byName) {
    const filePath = assertPathWithinDir(path.join(skillsDir, byName.fileName), skillsDir);
    return { meta: byName, filePath };
  }

  const byFile = skills.find(
    (skill) => skill.fileName.toLowerCase() === `${name.toLowerCase()}.md`,
  );
  if (byFile) {
    const filePath = assertPathWithinDir(path.join(skillsDir, byFile.fileName), skillsDir);
    return { meta: byFile, filePath };
  }

  const availableSkills = skills.map((skill) => skill.name).join(", ");
  throw new Error(`Skill not found: ${name}. Available: ${availableSkills || "none"}`);
};

/**
 * Serialize skill frontmatter and body into a markdown file.
 */
export const formatSkillFile = (
  frontmatter: Pick<SkillMeta, "name" | "description">,
  body: string,
): string =>
  `---\nname: ${frontmatter.name}\ndescription: ${frontmatter.description}\n---\n\n${body.trim()}\n`;

/**
 * Read a skill's body content by name (case-insensitive match on frontmatter name)
 * or fileName. Path-safe: ensures resolved path stays within skillsDir.
 * Throws on not found or path traversal attempt.
 */
export const readSkillContent = (skillsDir: string, name: string): string => {
  const { filePath } = resolveSkillMeta(skillsDir, name);
  const content = readFileSync(filePath, "utf8");
  const { body } = parseFrontmatter(content);
  return body;
};

/**
 * Read a skill's full frontmatter and body.
 */
export const readFullSkill = (
  skillsDir: string,
  name: string,
): SkillMeta & { body: string } => {
  const { meta, filePath } = resolveSkillMeta(skillsDir, name);
  const content = readFileSync(filePath, "utf8");
  const { data, body } = parseFrontmatter(content);

  return {
    name: data.name ?? meta.name,
    description: data.description ?? meta.description,
    fileName: meta.fileName,
    body,
  };
};

/**
 * Write a skill file to disk, creating the directory if needed.
 */
export const writeSkillFile = (
  skillsDir: string,
  fileName: string,
  name: string,
  description: string,
  body: string,
): string => {
  validateSkillFields(name, description);

  const filePath = assertPathWithinDir(path.join(skillsDir, fileName), skillsDir);
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(filePath, formatSkillFile({ name, description }, body), "utf8");
  return filePath;
};

/**
 * Create a new skill file. Throws if the skill already exists.
 */
export const createSkillFile = (
  skillsDir: string,
  name: string,
  description: string,
  body: string,
): string => {
  validateSkillFields(name, description);

  const existingSkills = listSkills(skillsDir);
  if (existingSkills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Skill already exists: ${name}`);
  }

  const fileName = `${name}.md`;
  const targetPath = assertPathWithinDir(path.join(skillsDir, fileName), skillsDir);
  if (existsSync(targetPath)) {
    throw new Error(`Skill file already exists: ${fileName}`);
  }

  return writeSkillFile(skillsDir, fileName, name, description, body);
};

/**
 * Replace an existing skill's frontmatter and body.
 */
export const updateSkillFile = (
  skillsDir: string,
  name: string,
  description: string,
  body: string,
): string => {
  validateSkillFields(name, description);
  const { meta } = resolveSkillMeta(skillsDir, name);
  return writeSkillFile(skillsDir, meta.fileName, meta.name, description, body);
};

/**
 * Delete an existing skill file.
 */
export const deleteSkillFile = (skillsDir: string, name: string): string => {
  const { meta, filePath } = resolveSkillMeta(skillsDir, name);
  unlinkSync(filePath);
  return meta.fileName;
};

/**
 * Format a single skill using the configuration skill_output_template.
 */
export const formatSkillForDisplay = (
  owner: string,
  skill: Pick<SkillMeta, "name" | "description">,
  status: SkillDisplayStatus,
): string =>
  [
    `Owner: ${owner}`,
    `Skill Name: ${skill.name}`,
    `Description: ${skill.description}`,
    `Status: ${status}`,
  ].join("\n");

/**
 * Format a skill list for user-facing LIST responses.
 */
export const formatSkillsForDisplay = (
  owner: string,
  skills: SkillMeta[],
  status: SkillDisplayStatus = "Listed",
): string => {
  if (skills.length === 0) {
    return `No skills configured for ${owner}.`;
  }

  return skills.map((skill) => formatSkillForDisplay(owner, skill, status)).join("\n\n");
};

/**
 * Format a list of skills for insertion into a system prompt.
 * Returns a string block with skill name and description.
 */
export const formatSkillsForPrompt = (skills: SkillMeta[]): string => {
  if (skills.length === 0) {
    return "";
  }

  const formatted = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `<available_skills>\n${formatted}\n</available_skills>`;
};
