import { z } from "zod";
import {
  fileExists,
  listDirectoryContents,
  readTextFile,
  resolveSafePath,
  searchFilesByContent,
  writeTextFile,
} from "../utils/file-system.js";

// Active schema validation
const RelativePathSchema = z
  .string()
  .min(1)
  .describe("The destination path relative to the vault root.")
  .refine((value) => !value.includes(".."), {
    message: "Path traversal is forbidden.",
  });

/**
 * Validates the relative path schema and resolves it to a safe physical absolute path.
 */
export const resolveVaultPath = (vaultRoot: string, relativePath: string): string => {
  const result = RelativePathSchema.safeParse(relativePath);
  if (!result.success) {
    throw new Error(`Invalid path: ${result.error.issues[0]?.message}`);
  }
  try {
    return resolveSafePath(vaultRoot, relativePath);
  } catch {
    throw new Error("Path must stay inside the local vault.");
  }
};

/**
 * Normalizes input directories (removing trailing slashes and redundant dots)
 */
const normalizeRelativeDir = (relativeDir: string): string => {
  const clean = relativeDir.replace(/[\\/]+$/, "").trim();
  return clean === "" ? "." : clean;
};

export const applyFileWrite = async (
  vaultRoot: string, 
  operationRequest: { 
    relativePath: string; 
    operation: "create_new" | "append" | "overwrite"; 
    content: string; 
    summary: string 
  }
): Promise<string> => {
  const { relativePath, operation, content } = operationRequest;
  resolveVaultPath(vaultRoot, relativePath);

  const cleanContent = content?.trim() ?? "";

  if (operation === "create_new") {
    if (await fileExists(vaultRoot, relativePath)) {
      throw new Error(`Refusing to overwrite existing markdown file: ${relativePath}`);
    }
    await writeTextFile(vaultRoot, relativePath, cleanContent === "" ? "" : `${cleanContent}\n`);
    return relativePath;
  }

  if (operation === "overwrite") {
    if (!cleanContent) throw new Error("Overwrite operations must include content.");
    await writeTextFile(vaultRoot, relativePath, `${cleanContent}\n`);
    return relativePath;
  }

  // Operation is "append"
  let existingContent = "";
  try {
    existingContent = await readTextFile(vaultRoot, relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const normalizedExisting = existingContent.replace(/\s*$/, "");
  let appendPrefix = "\n\n";

  if (
    normalizedExisting.length === 0 ||
    normalizedExisting.endsWith("\n") ||
    normalizedExisting.trim().split("\n").pop()?.trim().startsWith("-")
  ) {
    appendPrefix = "\n";
  }

  if (!cleanContent) throw new Error("Append operations must include content.");

  const finalContent = `${normalizedExisting}${appendPrefix}${cleanContent}\n`;
  await writeTextFile(vaultRoot, relativePath, finalContent);
  return relativePath;
};

export const readVaultFile = async (vaultRoot: string, relativePath: string): Promise<string> => {
  resolveVaultPath(vaultRoot, relativePath);
  try {
    return await readTextFile(vaultRoot, relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Cannot read missing file: ${relativePath}`);
    }
    throw error;
  }
};

export const checkFileExists = async (vaultRoot: string, relativePath: string): Promise<boolean> => {
  resolveVaultPath(vaultRoot, relativePath);
  return fileExists(vaultRoot, relativePath);
};

export const listFiles = async (vaultRoot: string, relativeDir: string): Promise<string[]> => {
  const cleanDir = normalizeRelativeDir(relativeDir);
  const { files } = await listDirectoryContents(vaultRoot, cleanDir);
  return files;
};

export const listDirContents = async (
  vaultRoot: string,
  relativeDir: string,
): Promise<{ files: string[]; dirs: string[] }> => {
  const cleanDir = normalizeRelativeDir(relativeDir);
  return listDirectoryContents(vaultRoot, cleanDir);
};

/**
 * Recursively walk directory and collect all .md files.
 * Rebuilt using modern iteration and paths arrays to prevent massive overhead.
 */
const walkFilesRecursive = async (vaultRoot: string, relativeDir: string): Promise<string[]> => {
  const cleanDir = normalizeRelativeDir(relativeDir);
  try {
    const { files, dirs } = await listDirContents(vaultRoot, cleanDir);
    const results: string[] = [...files];

    await Promise.all(
      dirs.map(async (dir) => {
        const nestedPath = cleanDir === "." ? dir : `${cleanDir}/${dir}`;
        const nestedFiles = await walkFilesRecursive(vaultRoot, nestedPath);
        results.push(...nestedFiles);
      })
    );

    return results;
  } catch {
    return [];
  }
};

const normalizeSearchQueries = (queries: string[]): string[] => {
  const normalized = queries
    .flatMap((query) => query.split(/[\s/._-]+/g))
    .map((query) => query.trim())
    .filter((query) => query.length > 0);

  return Array.from(new Set(normalized));
};

export const searchFiles = async (
  vaultRoot: string,
  queries: string[],
  relativeDir: string,
): Promise<string[]> => {
  const cleanDir = normalizeRelativeDir(relativeDir);
  const normalizedQueries = normalizeSearchQueries(queries).map((q) => q.toLowerCase());

  if (normalizedQueries.length === 0) return [];

  const [contentMatches, allFiles] = await Promise.all([
    searchFilesByContent(vaultRoot, normalizedQueries, cleanDir),
    walkFilesRecursive(vaultRoot, cleanDir)
  ]);

  const filenameMatches = allFiles.filter((file) =>
    normalizedQueries.some((query) => file.toLowerCase().includes(query))
  );

  return Array.from(new Set([...contentMatches, ...filenameMatches]));
};

export const searchFilesByName = async (
  vaultRoot: string,
  queries: string[],
  relativeDir: string,
): Promise<string[]> => {
  const cleanDir = normalizeRelativeDir(relativeDir);
  const normalizedQueries = normalizeSearchQueries(queries).map((q) => q.toLowerCase());

  if (normalizedQueries.length === 0) return [];

  const allFiles = await walkFilesRecursive(vaultRoot, cleanDir);
  
  // Transform queries to localized RegExp word boundaries beforehand for optimization
  const regexes = normalizedQueries.map((query) => {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\w\\d])${escaped}(?![\\w\\d])`, "i");
  });

  return allFiles.filter((file) => {
    const lowerFile = file.toLowerCase();
    return regexes.every((rx) => rx.test(lowerFile));
  });
};