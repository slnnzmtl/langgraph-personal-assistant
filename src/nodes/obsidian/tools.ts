import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { IFileSender } from "../../telegram/file-sender.js";
import { createReadSkillTool } from "../../tools/skill-management.js";
import {
  RelativePathSchema,
  resolveVaultPath,
  applyFileWrite,
  readVaultFile,
  checkFileExists,
  listDirContents,
  searchFiles,
  searchFilesByName,
} from "../../services/obsidian.js";

const MarkdownContentSchema = z
  .string()
  .min(1);

const MarkdownSummarySchema = z
  .string()
  .min(1);

export const ReadFileToolSchema = z.object({
  relativePath: RelativePathSchema,
}).describe("Read the full contents of a file.");

export const WriteFileToolSchema = z.object({
  relativePath: RelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite"]),
  content: MarkdownContentSchema,
  summary: MarkdownSummarySchema,
}).describe("Write or modify a file in the vault.");

const RelativeDirSchema = z
  .string()
  .optional()
  .default(".")
  .refine((v) => !v.includes(".."), { message: "Path traversal is forbidden." });

export const ListFilesToolSchema = z.object({
  relativeDir: RelativeDirSchema,
}).describe("List files and subdirectories in a vault directory.");

export const SearchFilesToolSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).describe("Array of search terms (OR semantics: file matches if content contains any term). Terms will be lowercased before matching."),
  relativeDir: RelativeDirSchema,
}).describe("Recursively search files by content or vault-relative path. Searches entire vault by default (relativeDir defaults to '.').");

export const SearchFilesByNameToolSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).describe("Array of search terms (OR semantics: file matches if filename contains any term). Terms will be lowercased before matching."),
  relativeDir: RelativeDirSchema,
}).describe("Recursively search for files by filename in entire vault or subdirectory. Uses AND semantics: a file matches only if its filename contains ALL supplied terms. Split multi-word queries into individual terms (e.g. 'July 1' → ['July', '1']).");

export const SendFileToolSchema = z.object({
  relativePath: RelativePathSchema,
  caption: z.string().optional().describe("Optional caption to attach to the file."),
}).describe("Send a file from the vault as a Telegram document.");

export const createObsidianTools = (vaultRoot: string, fileSender?: IFileSender) => {
  const baseTools = [
    createReadSkillTool("obsidian", "xml"),
    tool(
      async ({ relativePath }) => {
        try { return await readVaultFile(vaultRoot, relativePath); }
        catch (e: any) { return `Error: ${e.message}`; }
      },
      { name: "read_file", description: "Read the full contents of a file to view tasks or text structure.", schema: ReadFileToolSchema },
    ),
    tool(
      async (args: z.infer<typeof WriteFileToolSchema>) => {
        try {
          if (args.operation === "create_new" && await checkFileExists(vaultRoot, args.relativePath)) {
            return `Notice: File already exists at ${args.relativePath}. Use append or overwrite instead.`;
          }

          await applyFileWrite(vaultRoot, args);
          return `Success: ${args.summary} saved to ${args.relativePath}.`;
        } catch (e: any) { return `Error: ${e.message}`; }
      },
      {
        name: "write_file",
        description: "Write content to a file. Set operation to 'append' for adding lines, or 'overwrite' to update existing text cleanly.",
        schema: WriteFileToolSchema,
      },
    ),
    tool(
      async ({ relativeDir }: z.infer<typeof ListFilesToolSchema>) => {
        try {
          const { files, dirs } = await listDirContents(vaultRoot, relativeDir);
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
        name: "list_files",
        description: "List files and subdirectories in a vault directory. Omit relativeDir to list the vault root.",
        schema: ListFilesToolSchema,
      },
    ),
    tool(
      async ({ queries, relativeDir }: z.infer<typeof SearchFilesToolSchema>) => {
        try {
          const matches = await searchFiles(vaultRoot, queries, relativeDir);
          return matches.length > 0 ? matches.join("\n") : "No files matched your search.";
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
      {
        name: "search_files",
        description: "Search files by content or vault-relative path across the vault or within a directory using OR semantics. Each query term is lowercased before matching; a file matches if its content or relative path contains any of the supplied terms.",
        schema: SearchFilesToolSchema,
      },
    ),
    tool(
      async ({ queries, relativeDir }: z.infer<typeof SearchFilesByNameToolSchema>) => {
        try {
          const matches = await searchFilesByName(vaultRoot, queries, relativeDir);
          return matches.length > 0 ? matches.join("\n") : "No files matched your search.";
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
      {
        name: "search_files_by_name",
        description: "Search for files by filename using case-insensitive matching. Query terms are lowercased before matching; a file matches if its filename contains any of the supplied search terms (OR semantics).",
        schema: SearchFilesByNameToolSchema,
      },
    ),
  ] as const;

  if (fileSender) {
    return [
      ...baseTools,
      tool(
        async ({ relativePath }: z.infer<typeof SendFileToolSchema>) => {
          try {
            if (!await checkFileExists(vaultRoot, relativePath)) {
              return `Error: File does not exist at ${relativePath}`;
            }
            const absolutePath = resolveVaultPath(vaultRoot, relativePath);
            await fileSender.sendFile(absolutePath);
            return `File sent: ${relativePath}`;
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
        {
          name: "send_file",
          description: "Send a file from the vault as a Telegram document to the current user.",
          schema: SendFileToolSchema,
        },
      ),
    ] as any;
  }

  return baseTools as any;
};
