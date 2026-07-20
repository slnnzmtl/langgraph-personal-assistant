import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SkillAttachmentRule } from "../core/types/agent.js";

/**
 * Metadata extracted from a skill file's frontmatter.
 */
export interface SkillMeta {
  name: string;
  description: string;
  fileName: string;
}

export type SkillDisplayStatus = "Created" | "Updated" | "Deleted" | "Listed" | "Previewed" | "Read";

export type SkillFileType = "md" | "xml";

export const SKILL_FILE_EXTENSIONS: Record<SkillFileType, string> = {
  md: ".md",
  xml: ".xml",
};

/**
 * Result of parsing frontmatter from raw markdown.
 */
interface FrontmatterResult {
  data: Record<string, string>;
  body: string;
}

export const getSkillFileType = (fileName: string): SkillFileType | undefined => {
  if (fileName.endsWith(".xml")) {
    return "xml";
  }

  if (fileName.endsWith(".md")) {
    return "md";
  }

  return undefined;
};

const escapeXmlAttr = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const SKILL_ATTACHMENTS_BLOCK_REGEX = /<skill_attachments>[\s\S]*?<\/skill_attachments>\s*/i;
const ATTACHMENT_BLOCK_REGEX = /<attachment(?:\s+cronJobName=["']([^"']+)["'])?\s*>([\s\S]*?)<\/attachment>/gi;
const ANY_PHRASES_REGEX = /<anyPhrases>([\s\S]*?)<\/anyPhrases>/i;
const ALL_PHRASES_REGEX = /<allPhrases>([\s\S]*?)<\/allPhrases>/i;

export const parseCommaSeparatedPhrases = (raw: string): string[] =>
  raw
    .split(",")
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

const parseAttachmentMatchBlock = (block: string): SkillAttachmentRule["match"] | undefined => {
  const anyMatch = block.match(ANY_PHRASES_REGEX);
  const allMatch = block.match(ALL_PHRASES_REGEX);
  const anyPhrases = anyMatch?.[1] ? parseCommaSeparatedPhrases(anyMatch[1]) : [];
  const allPhrases = allMatch?.[1] ? parseCommaSeparatedPhrases(allMatch[1]) : [];

  if (anyPhrases.length === 0 && allPhrases.length === 0) {
    return undefined;
  }

  return {
    ...(anyPhrases.length > 0 ? { anyPhrases } : {}),
    ...(allPhrases.length > 0 ? { allPhrases } : {}),
  };
};

export const parseSkillAttachmentsFromXmlBody = (body: string): SkillAttachmentRule[] => {
  const attachmentsBlock = body.match(SKILL_ATTACHMENTS_BLOCK_REGEX)?.[0];
  if (!attachmentsBlock) {
    return [];
  }

  const rules: SkillAttachmentRule[] = [];
  for (const match of attachmentsBlock.matchAll(ATTACHMENT_BLOCK_REGEX)) {
    const cronJobName = match[1]?.trim();
    const attachmentBody = match[2] ?? "";
    const matchRules = parseAttachmentMatchBlock(attachmentBody);

    if (!cronJobName && !matchRules) {
      continue;
    }

    rules.push({
      owner: "",
      skillName: "",
      ...(cronJobName ? { cronJobName } : {}),
      ...(matchRules ? { match: matchRules } : {}),
    });
  }

  return rules;
};

export const stripSkillAttachmentsBlock = (body: string): string =>
  body.replace(SKILL_ATTACHMENTS_BLOCK_REGEX, "").trim();

/**
 * Parse a skill XML file with metadata on the root <skill> element.
 */
export const parseXmlSkill = (raw: string): FrontmatterResult => {
  const trimmed = raw.trim();
  const openTagMatch = trimmed.match(/^<skill\s+([^>]+)>/s);

  if (!openTagMatch) {
    return { data: {}, body: trimmed };
  }

  const attrs = openTagMatch[1] ?? "";
  const nameMatch = attrs.match(/name=["']([^"']+)["']/);
  const descriptionMatch = attrs.match(/description=["']([^"']+)["']/);

  let body = trimmed.slice(openTagMatch[0].length);
  const closeTagIndex = body.lastIndexOf("</skill>");
  if (closeTagIndex >= 0) {
    body = body.slice(0, closeTagIndex);
  }

  const data: Record<string, string> = {};
  if (nameMatch?.[1]) {
    data.name = nameMatch[1];
  }
  if (descriptionMatch?.[1]) {
    data.description = descriptionMatch[1];
  }

  return { data, body: stripSkillAttachmentsBlock(body.trim()) };
};

export const loadSkillAttachmentRules = (
  skillsDir: string,
  owner: string,
): SkillAttachmentRule[] => {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const rules: SkillAttachmentRule[] = [];
  const files = readdirSync(skillsDir).filter((fileName) => fileName.endsWith(".xml"));

  for (const fileName of files) {
    try {
      const content = readFileSync(path.join(skillsDir, fileName), "utf8");
      const { data, body } = parseXmlSkill(content);
      const skillName = data.name;
      if (!skillName) {
        continue;
      }

      const rawBody = content.match(/^<skill\s+[^>]+>([\s\S]*)<\/skill>\s*$/s)?.[1]?.trim() ?? body;
      const attachmentRules = parseSkillAttachmentsFromXmlBody(rawBody);
      for (const rule of attachmentRules) {
        rules.push({
          ...rule,
          owner,
          skillName,
        });
      }
    } catch (error) {
      console.warn(`Failed to parse attachment rules from skill file ${fileName}:`, error);
    }
  }

  return rules;
};

/**
 * Parse a skill file based on its extension.
 */
export const parseSkillFile = (raw: string, fileName: string): FrontmatterResult => {
  if (getSkillFileType(fileName) === "xml") {
    return parseXmlSkill(raw);
  }

  return parseFrontmatter(raw);
};

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

  const files = readdirSync(skillsDir).filter(
    (fileName) => fileName.endsWith(".md") || fileName.endsWith(".xml"),
  );
  const skills: SkillMeta[] = [];

  for (const fileName of files) {
    try {
      const content = readFileSync(path.join(skillsDir, fileName), "utf8");
      const { data } = parseSkillFile(content, fileName);

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

  const byFile = skills.find((skill) => {
    const normalizedName = name.toLowerCase();
    return (
      skill.fileName.toLowerCase() === `${normalizedName}.md`
      || skill.fileName.toLowerCase() === `${normalizedName}.xml`
    );
  });
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
 * Serialize skill metadata and body into an XML file.
 */
export const formatXmlSkillFile = (
  frontmatter: Pick<SkillMeta, "name" | "description">,
  body: string,
): string =>
  `<skill name="${escapeXmlAttr(frontmatter.name)}" description="${escapeXmlAttr(frontmatter.description)}">\n\n${body.trim()}\n\n</skill>\n`;

export const serializeSkillFile = (
  frontmatter: Pick<SkillMeta, "name" | "description">,
  body: string,
  fileName: string,
): string => {
  if (getSkillFileType(fileName) === "xml") {
    return formatXmlSkillFile(frontmatter, body);
  }

  return formatSkillFile(frontmatter, body);
};

/**
 * Read a skill's body content by name (case-insensitive match on frontmatter name)
 * or fileName. Path-safe: ensures resolved path stays within skillsDir.
 * Throws on not found or path traversal attempt.
 */
export const readSkillContent = (skillsDir: string, name: string): string => {
  const { filePath } = resolveSkillMeta(skillsDir, name);
  const content = readFileSync(filePath, "utf8");
  const { body } = parseSkillFile(content, path.basename(filePath));
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
  const { data, body } = parseSkillFile(content, meta.fileName);

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
  writeFileSync(filePath, serializeSkillFile({ name, description }, body, fileName), "utf8");
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
