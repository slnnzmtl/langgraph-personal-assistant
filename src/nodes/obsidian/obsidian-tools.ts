import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  .describe("Markdown content to write into the target file.");

const MarkdownSummarySchema = z
  .string()
  .min(1)
  .describe("A concise user-facing confirmation explaining what changed.");

export const ReadMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
});

export const WriteMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite"]),
  content: MarkdownContentSchema,
  summary: MarkdownSummarySchema,
});

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
];
