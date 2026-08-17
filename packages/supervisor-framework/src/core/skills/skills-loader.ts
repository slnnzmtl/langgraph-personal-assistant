import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { withSerializedFileWrite } from "../persistence/json-store.js";

import type { SkillAttachmentRule, SkillDisplayStatus, SkillMeta, ListSkillsOptions, SkillSource, SkillStoreOptions } from "./catalog.js";

export const SKILLS_ROOT = path.resolve(process.cwd(), "skills");

export const describeWritableSkillLocation = (name: string): string =>
  `data/skills/${name}.xml`;

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

const parseXmlAttribute = (attrs: string, attrName: string): string | undefined => {
  const match = attrs.match(new RegExp(`${attrName}=("([^"]*)"|'([^']*)')`));
  const raw = match?.[2] ?? match?.[3];
  if (raw === undefined) {
    return undefined;
  }
  return raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
};

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
      module: "",
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
  const name = parseXmlAttribute(attrs, "name");
  const description = parseXmlAttribute(attrs, "description");
  const module = parseXmlAttribute(attrs, "module");

  let body = trimmed.slice(openTagMatch[0].length);
  const closeTagIndex = body.lastIndexOf("</skill>");
  if (closeTagIndex >= 0) {
    body = body.slice(0, closeTagIndex);
  }

  const data: Record<string, string> = {};
  if (name) {
    data.name = name;
  }
  if (description) {
    data.description = description;
  }
  if (module) {
    data.module = module;
  }

  return { data, body: stripSkillAttachmentsBlock(body.trim()) };
};

export const loadSkillAttachmentRules = (
  module: string,
  options: SkillStoreOptions | string = SKILLS_ROOT,
): SkillAttachmentRule[] => {
  const storeOptions = normalizeStoreOptions(options);
  const skills = listSkills({ module, ...storeOptions });
  const rules: SkillAttachmentRule[] = [];

  for (const skill of skills) {
    try {
      const { filePath } = resolveSkillMeta(skill.name, { module, ...storeOptions });
      const content = readFileSync(filePath, "utf8");
      const rawBody = content.match(/^<skill\s+[^>]+>([\s\S]*)<\/skill>\s*$/s)?.[1]?.trim() ?? "";
      const attachmentRules = parseSkillAttachmentsFromXmlBody(rawBody);
      for (const rule of attachmentRules) {
        rules.push({
          ...rule,
          module,
          skillName: skill.name,
        });
      }
    } catch (error) {
      console.warn(`Failed to parse attachment rules from skill file ${skill.fileName}:`, error);
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

const resolveSkillsDir = (options?: ListSkillsOptions): string =>
  options?.skillsDir ?? SKILLS_ROOT;

const normalizeStoreOptions = (
  skillsDirOrOptions?: string | SkillStoreOptions,
): SkillStoreOptions => {
  if (typeof skillsDirOrOptions === "string") {
    return { skillsDir: skillsDirOrOptions };
  }

  return skillsDirOrOptions ?? {};
};

const resolveWriteDir = (options: SkillStoreOptions): string =>
  options.writableSkillsDir ?? options.skillsDir ?? SKILLS_ROOT;

const skillRootDir = (skill: SkillMeta, options: SkillStoreOptions): string => {
  if (skill.source === "data" && options.writableSkillsDir) {
    return options.writableSkillsDir;
  }

  return options.skillsDir ?? SKILLS_ROOT;
};

const listSkillsFromDirectory = (
  skillsDir: string,
  source: SkillSource,
  module?: string,
): SkillMeta[] => {
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
          `Skill file ${fileName} missing 'name' or 'description'; skipping.`,
        );
        continue;
      }

      if (getSkillFileType(fileName) === "xml" && !data.module) {
        console.warn(`Skill file ${fileName} missing 'module' attribute; skipping.`);
        continue;
      }

      if (module && data.module !== module) {
        continue;
      }

      skills.push({
        name: data.name,
        description: data.description,
        ...(data.module ? { module: data.module } : {}),
        fileName,
        source,
      });
    } catch (error) {
      console.warn(`Failed to parse skill file ${fileName}:`, error);
    }
  }

  return skills;
};

const mergeSkillsByName = (shipped: SkillMeta[], data: SkillMeta[]): SkillMeta[] => {
  const byName = new Map<string, SkillMeta>();

  for (const skill of shipped) {
    byName.set(skill.name.toLowerCase(), skill);
  }

  for (const skill of data) {
    byName.set(skill.name.toLowerCase(), skill);
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * List skills in the flat skills store, optionally filtered by module.
 */
export const listSkills = (options?: ListSkillsOptions): SkillMeta[] => {
  const skillsDir = resolveSkillsDir(options);
  const shipped = listSkillsFromDirectory(skillsDir, "shipped", options?.module);

  if (!options?.writableSkillsDir) {
    return shipped;
  }

  const data = listSkillsFromDirectory(options.writableSkillsDir, "data", options?.module);
  return mergeSkillsByName(shipped, data);
};

export const listSkillModules = (options?: SkillStoreOptions): string[] => {
  const storeOptions = normalizeStoreOptions(options);
  const modules = new Set<string>();

  for (const skill of listSkills(storeOptions)) {
    if (skill.module) {
      modules.add(skill.module);
    }
  }

  return [...modules].sort();
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

const validateSkillFields = (name: string, description: string, module?: string): void => {
  if (!name.trim()) {
    throw new Error("Skill name is required.");
  }

  if (!description.trim()) {
    throw new Error("Skill description is required.");
  }

  if (module !== undefined && !module.trim()) {
    throw new Error("Skill module is required.");
  }
};

/**
 * Find a skill by name (case-insensitive) or filename within the flat store.
 */
export const resolveSkillMeta = (
  name: string,
  options?: ListSkillsOptions,
): ResolvedSkill => {
  const storeOptions = normalizeStoreOptions(options);
  const skills = listSkills(storeOptions);

  const byName = skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
  if (byName) {
    const rootDir = skillRootDir(byName, storeOptions);
    const filePath = assertPathWithinDir(path.join(rootDir, byName.fileName), rootDir);
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
    const rootDir = skillRootDir(byFile, storeOptions);
    const filePath = assertPathWithinDir(path.join(rootDir, byFile.fileName), rootDir);
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
  frontmatter: Pick<SkillMeta, "name" | "description" | "module">,
  body: string,
): string => {
  const moduleAttr = frontmatter.module
    ? ` module="${escapeXmlAttr(frontmatter.module)}"`
    : "";

  return `<skill name="${escapeXmlAttr(frontmatter.name)}"${moduleAttr} description="${escapeXmlAttr(frontmatter.description)}">\n\n${body.trim()}\n\n</skill>\n`;
};

export const serializeSkillFile = (
  frontmatter: Pick<SkillMeta, "name" | "description" | "module">,
  body: string,
  fileName: string,
): string => {
  if (getSkillFileType(fileName) === "xml") {
    return formatXmlSkillFile(frontmatter, body);
  }

  return formatSkillFile(frontmatter, body);
};

/**
 * Read a skill's body content by name.
 */
export const readSkillContent = (name: string, options?: ListSkillsOptions): string => {
  const { filePath } = resolveSkillMeta(name, options);
  const content = readFileSync(filePath, "utf8");
  const { body } = parseSkillFile(content, path.basename(filePath));
  return body;
};

/**
 * Read a skill's full metadata and body.
 */
export const readFullSkill = (
  name: string,
  options?: ListSkillsOptions,
): SkillMeta & { body: string } => {
  const { meta, filePath } = resolveSkillMeta(name, options);
  const content = readFileSync(filePath, "utf8");
  const { data, body } = parseSkillFile(content, meta.fileName);

  return {
    name: data.name ?? meta.name,
    description: data.description ?? meta.description,
    ...(data.module ?? meta.module ? { module: data.module ?? meta.module } : {}),
    fileName: meta.fileName,
    body,
  };
};

const writeSkillFileAtomically = async (
  filePath: string,
  content: string,
): Promise<void> => {
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
};

const resolveSkillWriteLockKey = (writeDir: string): string => path.resolve(writeDir);

const writeSkillContent = async (
  fileName: string,
  name: string,
  description: string,
  body: string,
  module: string | undefined,
  skillsDir: string,
): Promise<string> => {
  validateSkillFields(name, description, module);

  const filePath = assertPathWithinDir(path.join(skillsDir, fileName), skillsDir);
  const content = serializeSkillFile(
    { name, description, ...(module ? { module } : {}) },
    body,
    fileName,
  );
  await writeSkillFileAtomically(filePath, content);
  return filePath;
};

/**
 * Write a skill file to disk atomically, creating the directory if needed.
 */
export const writeSkillFile = async (
  fileName: string,
  name: string,
  description: string,
  body: string,
  module?: string,
  skillsDir: string = SKILLS_ROOT,
): Promise<string> =>
  withSerializedFileWrite(resolveSkillWriteLockKey(skillsDir), async () =>
    writeSkillContent(fileName, name, description, body, module, skillsDir),
  );

/**
 * Create a new skill file. Throws if the skill already exists.
 */
export const createSkillFile = async (
  name: string,
  description: string,
  body: string,
  module: string,
  skillsDirOrOptions: string | SkillStoreOptions = SKILLS_ROOT,
): Promise<string> => {
  validateSkillFields(name, description, module);

  const storeOptions = normalizeStoreOptions(skillsDirOrOptions);
  const writeDir = resolveWriteDir(storeOptions);
  const fileName = `${name}.xml`;

  return withSerializedFileWrite(resolveSkillWriteLockKey(writeDir), async () => {
    const existingSkills = listSkills(storeOptions);

    if (existingSkills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Skill already exists: ${name}`);
    }

    const targetPath = assertPathWithinDir(path.join(writeDir, fileName), writeDir);
    if (existsSync(targetPath)) {
      throw new Error(`Skill file already exists: ${fileName}`);
    }

    return writeSkillContent(fileName, name, description, body, module, writeDir);
  });
};

/**
 * Replace an existing skill's metadata and body.
 */
export const updateSkillFile = async (
  name: string,
  description: string,
  body: string,
  module: string,
  skillsDirOrOptions: string | SkillStoreOptions = SKILLS_ROOT,
): Promise<string> => {
  validateSkillFields(name, description, module);
  const storeOptions = normalizeStoreOptions(skillsDirOrOptions);
  const { meta } = resolveSkillMeta(name, storeOptions);
  const writeDir = resolveWriteDir(storeOptions);

  return withSerializedFileWrite(resolveSkillWriteLockKey(writeDir), async () =>
    writeSkillContent(meta.fileName, meta.name, description, body, module, writeDir),
  );
};

/**
 * Delete an existing skill file.
 */
export const deleteSkillFile = async (
  name: string,
  skillsDirOrOptions: string | SkillStoreOptions = SKILLS_ROOT,
): Promise<string> => {
  const storeOptions = normalizeStoreOptions(skillsDirOrOptions);
  const writeDir = storeOptions.writableSkillsDir;

  if (!writeDir) {
    const { meta, filePath } = resolveSkillMeta(name, storeOptions);

    return withSerializedFileWrite(resolveSkillWriteLockKey(path.dirname(filePath)), async () => {
      await unlink(filePath);
      return meta.fileName;
    });
  }

  return withSerializedFileWrite(resolveSkillWriteLockKey(writeDir), async () => {
    const dataSkills = listSkillsFromDirectory(writeDir, "data");
    const dataSkill = dataSkills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());

    if (dataSkill) {
      const filePath = assertPathWithinDir(path.join(writeDir, dataSkill.fileName), writeDir);
      await unlink(filePath);
      return dataSkill.fileName;
    }

    const shippedDir = storeOptions.skillsDir ?? SKILLS_ROOT;
    const shippedSkills = listSkillsFromDirectory(shippedDir, "shipped");
    if (shippedSkills.some((skill) => skill.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Cannot delete shipped skill: ${name}`);
    }

    throw new Error(`Skill not found: ${name}`);
  });
};

/**
 * Format a single skill using the configuration skill_output_template.
 */
export const formatSkillForDisplay = (
  module: string,
  skill: Pick<SkillMeta, "name" | "description">,
  status: SkillDisplayStatus,
): string =>
  [
    `Module: ${module}`,
    `Skill Name: ${skill.name}`,
    `Description: ${skill.description}`,
    `Status: ${status}`,
  ].join("\n");

/**
 * Format a skill list for user-facing LIST responses.
 */
export const formatSkillsForDisplay = (
  module: string,
  skills: SkillMeta[],
  status: SkillDisplayStatus = "Listed",
): string => {
  if (skills.length === 0) {
    return `No skills configured for ${module}.`;
  }

  return skills.map((skill) => formatSkillForDisplay(module, skill, status)).join("\n\n");
};

/**
 * Format a list of skills for insertion into a system prompt.
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
