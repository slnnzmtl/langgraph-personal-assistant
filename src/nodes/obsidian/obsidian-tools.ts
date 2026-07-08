import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  fileExists,
  listDirectoryContents,
  readTextFile,
  resolveSafePath,
  searchFilesByContent,
  writeTextFile,
} from "../../utils/file-system.js";

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
  .min(1);

const MarkdownSummarySchema = z
  .string()
  .min(1);

export const ReadMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
}).describe("Read the full contents of a markdown file.");

export const WriteMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite"]),
  content: MarkdownContentSchema,
  summary: MarkdownSummarySchema,
}).describe("Write or modify a markdown file in the vault.");

export const resolveVaultPath = (vaultRoot: string, relativePath: string): string => {
  try {
    return resolveSafePath(vaultRoot, relativePath);
  } catch {
    throw new Error("Markdown path must stay inside the local vault.");
  }
};

export const applyMarkdownWrite = async (vaultRoot: string, operationRequest: z.infer<typeof WriteMarkdownToolSchema>): Promise<string> => {
  const targetPath = resolveVaultPath(vaultRoot, operationRequest.relativePath);

  if (operationRequest.operation === "create_new") {
    if (await fileExists(vaultRoot, operationRequest.relativePath)) {
      throw new Error(`Refusing to overwrite existing markdown file: ${operationRequest.relativePath}`);
    }
    const nextContent = operationRequest.content?.trim() ?? "";
    await writeTextFile(vaultRoot, operationRequest.relativePath, nextContent.length === 0 ? "" : `${nextContent}\n`);
    return operationRequest.relativePath;
  }

  if (operationRequest.operation === "overwrite") {
    const nextContent = operationRequest.content?.trim();
    if (!nextContent) throw new Error("Overwrite operations must include content.");
    await writeTextFile(vaultRoot, operationRequest.relativePath, `${nextContent}\n`);
    return operationRequest.relativePath;
  }

  let existingContent = "";
  try {
    existingContent = await readTextFile(vaultRoot, operationRequest.relativePath);
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

  await writeTextFile(vaultRoot, operationRequest.relativePath, `${normalizedExisting}${appendPrefix}${appendContent}\n`);
  return operationRequest.relativePath;
};

export const readMarkdownFile = async (vaultRoot: string, relativePath: string): Promise<string> => {
  try {
    return await readTextFile(vaultRoot, relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Cannot read missing markdown file: ${relativePath}`);
    throw error;
  }
};

export const checkMarkdownExists = async (vaultRoot: string, relativePath: string): Promise<boolean> => {
  return fileExists(vaultRoot, relativePath);
};

export const listMarkdownFiles = async (vaultRoot: string, relativeDir: string): Promise<string[]> => {
  const { files } = await listDirectoryContents(vaultRoot, relativeDir, { fileExtension: ".md" });
  return files;
};

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
}).describe("Search for .md files whose content or vault-relative path matches any of the supplied search terms (OR semantics).");

export const listMarkdownDirContents = async (
  vaultRoot: string,
  relativeDir: string,
): Promise<{ files: string[]; dirs: string[] }> => {
  return listDirectoryContents(vaultRoot, relativeDir, { fileExtension: ".md" });
};

export const searchMarkdownFiles = async (
  vaultRoot: string,
  queries: string[],
  relativeDir: string,
): Promise<string[]> => {
  return searchFilesByContent(vaultRoot, queries, relativeDir, { fileExtension: ".md" });
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
      description: "Search .md files by content or vault-relative path across the vault or within a directory using OR semantics. Each query term is lowercased before matching; a file matches if its content or relative path contains any of the supplied terms.",
      schema: SearchMarkdownToolSchema,
    },
  ),
];
