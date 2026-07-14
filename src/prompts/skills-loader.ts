import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Metadata extracted from a skill file's frontmatter.
 */
export interface SkillMeta {
  name: string;
  description: string;
  fileName: string;
}

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

/**
 * Read a skill's body content by name (case-insensitive match on frontmatter name)
 * or fileName. Path-safe: ensures resolved path stays within skillsDir.
 * Throws on not found or path traversal attempt.
 */
export const readSkillContent = (skillsDir: string, name: string): string => {
  const skills = listSkills(skillsDir);
  
  // Try exact name match first (case-insensitive)
  const byName = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (byName) {
    const filePath = path.join(skillsDir, byName.fileName);
    const resolved = path.resolve(filePath);
    const dirResolved = path.resolve(skillsDir);

    if (!resolved.startsWith(dirResolved)) {
      throw new Error(`Path traversal detected: ${name}`);
    }

    const content = readFileSync(resolved, "utf8");
    const { body } = parseFrontmatter(content);
    return body;
  }

  // Fallback: try filename match (case-insensitive)
  const byFile = skills.find(
    (s) => s.fileName.toLowerCase() === `${name.toLowerCase()}.md`
  );
  if (byFile) {
    const filePath = path.join(skillsDir, byFile.fileName);
    const resolved = path.resolve(filePath);
    const dirResolved = path.resolve(skillsDir);

    if (!resolved.startsWith(dirResolved)) {
      throw new Error(`Path traversal detected: ${name}`);
    }

    const content = readFileSync(resolved, "utf8");
    const { body } = parseFrontmatter(content);
    return body;
  }

  const availableSkills = skills.map((s) => s.name).join(", ");
  throw new Error(
    `Skill not found: ${name}. Available: ${availableSkills || "none"}`
  );
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
