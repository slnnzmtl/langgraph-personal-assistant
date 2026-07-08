import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const MarkdownRelativePathSchema = z
  .string()
  .min(1)
  .describe("The destination path relative to the vault root, and it must end in .md.")
  .refine((value) => value.endsWith(".md"), {
    message: "relativePath must target a markdown file.",
  })
  .refine((value) => !value.includes(".."), {
    message: "Path traversal is forbidden.",
  });

const MarkdownContentSchema = z
  .string()
  .min(1)

const MarkdownSummarySchema = z
  .string()
  .min(1)

export const ReadMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
}).describe("Read the full contents of a markdown file.");

export const WriteMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite"]),
  content: MarkdownContentSchema,
  summary: MarkdownSummarySchema,
}).describe("Write or modify a markdown file in the vault.");

// TODO: Refactor the following functions to use a more robust file system abstraction that can handle errors and edge cases more gracefully, and consider adding logging for better traceability of file operations.
export const resolveVaultPath = (vaultRoot: string, relativePath: string): string => {
  const normalizedPath = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (normalizedPath.startsWith("../") || path.posix.isAbsolute(normalizedPath)) throw new Error("Markdown path must stay inside the local vault.");
  const absolutePath = path.resolve(vaultRoot, normalizedPath);
  const relativeToRoot = path.relative(vaultRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) throw new Error("Resolved markdown path escapes the local vault.");
  return absolutePath;
};

export const applyMarkdownWrite = async (vaultRoot: string, operationRequest: z.infer<typeof WriteMarkdownToolSchema>): Promise<string> => {
  const targetPath = resolveVaultPath(vaultRoot, operationRequest.relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });

  if (operationRequest.operation === "create_new") {
    try {
      await readFile(targetPath, "utf8");
      throw new Error(`Refusing to overwrite existing markdown file: ${operationRequest.relativePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const nextContent = operationRequest.content?.trim() ?? "";
    await writeFile(targetPath, nextContent.length === 0 ? "" : `${nextContent}\n`, "utf8");
    return operationRequest.relativePath;
  }

  if (operationRequest.operation === "overwrite") {
    const nextContent = operationRequest.content?.trim();
    if (!nextContent) throw new Error("Overwrite operations must include content.");
    await writeFile(targetPath, `${nextContent}\n`, "utf8");
    return operationRequest.relativePath;
  }

  let existingContent = "";
  try {
    existingContent = await readFile(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const normalizedExisting = existingContent.replace(/\s*$/, "");
  let appendPrefix = "\n\n";

  if (
    normalizedExisting.length === 0
    || normalizedExisting.endsWith("\n")
    || normalizedExisting.trim().split("\n").pop()?.trim().startsWith("-")
  ) {
    appendPrefix = "\n";
  }
  const appendContent = operationRequest.content?.trim();
  if (!appendContent) throw new Error("Append operations must include content.");

  await writeFile(targetPath, `${normalizedExisting}${appendPrefix}${appendContent}\n`, "utf8");
  return operationRequest.relativePath;
};

export const readMarkdownFile = async (vaultRoot: string, relativePath: string): Promise<string> => {
  try {
    return await readFile(resolveVaultPath(vaultRoot, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Cannot read missing markdown file: ${relativePath}`);
    throw error;
  }
};

export const checkMarkdownExists = async (vaultRoot: string, relativePath: string): Promise<boolean> => {
  try {
    await readFile(resolveVaultPath(vaultRoot, relativePath), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

export const listMarkdownFiles = async (vaultRoot: string, relativeDir: string): Promise<string[]> => {
  const dirPath = resolveVaultPath(vaultRoot, relativeDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.posix.join(relativeDir, entry.name));
}

const RelativeDirSchema = z
  .string()
  .optional()
  .default(".")
  .refine((v) => !v.includes(".."), { message: "Path traversal is forbidden." });

export const ListMarkdownToolSchema = z.object({
  relativeDir: RelativeDirSchema,
}).describe("List .md files and subdirectories in a vault directory.");

export const SearchMarkdownToolSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).describe("Array of search terms (OR semantics: file matches if content contains any term). Terms will be lowercased before matching."),
  relativeDir: RelativeDirSchema,
}).describe("Search for .md files whose content matches any of the supplied search terms (OR semantics).");

export const listMarkdownDirContents = async (
  vaultRoot: string,
  relativeDir: string,
): Promise<{ files: string[]; dirs: string[] }> => {
  const dirPath = resolveVaultPath(vaultRoot, relativeDir);
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.posix.join(relativeDir, e.name));
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  return { files, dirs };
};

export const searchMarkdownFiles = async (
  vaultRoot: string,
  queries: string[],
  relativeDir: string,
): Promise<string[]> => {
  const lowerQueries = queries.map((q) => q.toLowerCase());
  const resultSet = new Set<string>();

  const walk = async (currentAbsDir: string, currentRelDir: string) => {
    const entries = await readdir(currentAbsDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelPath = path.posix.join(currentRelDir, entry.name);
      const entryAbsPath = path.join(currentAbsDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryAbsPath, entryRelPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = await readFile(entryAbsPath, "utf8");
        const lowerContent = content.toLowerCase();
        // Match if any query term appears in the content (OR semantics)
        if (lowerQueries.some((query) => lowerContent.includes(query))) {
          resultSet.add(entryRelPath);
        }
      }
    }
  };

  await walk(resolveVaultPath(vaultRoot, relativeDir), relativeDir);
  return Array.from(resultSet).sort();
};

export const createObsidianTools = (vaultRoot: string) => [
  tool(
    async ({ relativePath }) => {
      try { return await readMarkdownFile(vaultRoot, relativePath); } 
      catch (e: any) { return `Error: ${e.message}`; }
    },
    { name: "read_markdown_file", description: "Read the full contents of a file to view tasks or text structure.", schema: ReadMarkdownToolSchema },
  ),
  tool(
    async (args: z.infer<typeof WriteMarkdownToolSchema>) => {
      try {
        if (args.operation === "create_new" && await checkMarkdownExists(vaultRoot, args.relativePath)) {
          return `Notice: File already exists at ${args.relativePath}. Use append or overwrite instead.`;
        }

        await applyMarkdownWrite(vaultRoot, args);
        return `Success: ${args.summary} saved to ${args.relativePath}.`;
      } catch (e: any) { return `Error: ${e.message}`; }
    },
    {
      name: "write_markdown_file",
      description: "Write content to a file. Set operation to 'append' for adding lines, or 'overwrite' to update existing text cleanly.",
      schema: WriteMarkdownToolSchema,
    },
  ),
  tool(
    async ({ relativeDir }: z.infer<typeof ListMarkdownToolSchema>) => {
      try {
        const { files, dirs } = await listMarkdownDirContents(vaultRoot, relativeDir);
        const lines = [
          ...files.map((f) => `file: ${f}`),
          ...dirs.map((d) => `dir: ${d}`),
        ];
        return lines.length > 0 ? lines.join("\n") : "No files or directories found.";
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
    {
      name: "list_markdown_files",
      description: "List .md files and subdirectories in a vault directory. Omit relativeDir to list the vault root.",
      schema: ListMarkdownToolSchema,
    },
  ),
  tool(
    async ({ queries, relativeDir }: z.infer<typeof SearchMarkdownToolSchema>) => {
      try {
        const matches = await searchMarkdownFiles(vaultRoot, queries, relativeDir);
        return matches.length > 0 ? matches.join("\n") : "No files matched your search.";
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
    {
      name: "search_markdown_files",
      description: "Search .md files by content across the vault or within a directory using OR semantics. Each query term is lowercased before matching; a file matches if its content contains any of the supplied terms.",
      schema: SearchMarkdownToolSchema,
    },
  ),
];
