import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const normalizeRelativePath = (relativePath: string): string => {
  const normalizedPath = path.posix.normalize(relativePath.replaceAll("\\", "/"));

  if (normalizedPath.startsWith("../") || path.posix.isAbsolute(normalizedPath)) {
    throw new Error("Path must stay inside the root directory.");
  }

  return normalizedPath;
};

export const resolveSafePath = (rootDir: string, relativePath: string): string => {
  const absolutePath = path.resolve(rootDir, normalizeRelativePath(relativePath));
  const relativeToRoot = path.relative(rootDir, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Resolved path escapes the root directory.");
  }

  return absolutePath;
};

export const readTextFile = async (rootDir: string, relativePath: string): Promise<string> => {
  return readFile(resolveSafePath(rootDir, relativePath), "utf8");
};

export const fileExists = async (rootDir: string, relativePath: string): Promise<boolean> => {
  try {
    await readFile(resolveSafePath(rootDir, relativePath), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const writeTextFile = async (rootDir: string, relativePath: string, content: string): Promise<void> => {
  const targetPath = resolveSafePath(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
};

export const appendTextFile = async (rootDir: string, relativePath: string, content: string): Promise<void> => {
  const targetPath = resolveSafePath(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await appendFile(targetPath, content, "utf8");
};

export const listDirectoryContents = async (
  rootDir: string,
  relativeDir: string,
  options?: { fileExtension?: string },
): Promise<{ files: string[]; dirs: string[] }> => {
  const dirPath = resolveSafePath(rootDir, relativeDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && (!options?.fileExtension || entry.name.endsWith(options.fileExtension)))
    .map((entry) => path.posix.join(relativeDir, entry.name));
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return { files, dirs };
};

export const searchFilesByContent = async (
  rootDir: string,
  queries: string[],
  relativeDir: string,
  options?: { fileExtension?: string },
): Promise<string[]> => {
  const lowerQueries = queries.map((query) => query.toLowerCase());
  const resultSet = new Set<string>();

  const walk = async (currentAbsDir: string, currentRelDir: string) => {
    const entries = await readdir(currentAbsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryAbsPath = path.join(currentAbsDir, entry.name);
      const entryRelPath = path.posix.join(currentRelDir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryAbsPath, entryRelPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (options?.fileExtension && !entry.name.endsWith(options.fileExtension)) {
        continue;
      }

      const content = await readFile(entryAbsPath, "utf8");
      const lowerContent = content.toLowerCase();

      if (lowerQueries.some((query) => lowerContent.includes(query))) {
        resultSet.add(entryRelPath);
      }
    }
  };

  await walk(resolveSafePath(rootDir, relativeDir), relativeDir);
  return Array.from(resultSet).sort();
};