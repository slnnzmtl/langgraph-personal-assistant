import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { ILLMConnector } from "../connectors/llm-connector.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

const vaultRoot = path.resolve(process.cwd(), "src/obsidian-vault");

const MarkdownWriteSchema = z
  .object({
    relativePath: z
      .string()
      .min(1)
      .describe("The destination path relative to the vault root, and it must end in .md."),
    operation: z
      .enum(["create_new", "append", "overwrite"])
      .describe("The file operation to perform inside the vault."),
    content: z.string().min(1).describe("Markdown content to write into the target file."),
    summary: z
      .string()
      .min(1)
      .describe("A concise user-facing confirmation explaining what changed."),
  })
  .refine((value) => value.relativePath.endsWith(".md"), {
    message: "relativePath must target a markdown file.",
    path: ["relativePath"],
  })
  .refine((value) => !value.relativePath.includes(".."), {
    message: "Path traversal is forbidden.",
    path: ["relativePath"],
  });

type MarkdownWriteRequest = z.infer<typeof MarkdownWriteSchema>;

const writerPrompt = new SystemMessage(`
You convert note-taking requests into safe markdown file edits inside a local vault.

Rules:
- Only target markdown files ending in .md.
- Return a relative path inside the vault, never an absolute path.
- Choose append when the user wants to add to an existing note.
- Choose overwrite only when the user explicitly wants replacement.
- Choose create_new for a new standalone note.
- Produce clean markdown without redundant explanation outside the file content.
- The summary must be a short confirmation for the end user.
`);

const extractTextContent = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part.type === "text") {
          return part.text;
        }

        return "[non-text content omitted]";
      })
      .join("\n");
  }

  return JSON.stringify(content);
};

const getLatestUserRequest = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message instanceof HumanMessage) {
      return extractTextContent(message.content);
    }
  }

  throw new Error("No user message found for markdown generation.");
};

const listMarkdownFiles = async (directory: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.posix.join(prefix, entry.name);
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listMarkdownFiles(absolutePath, relativePath);
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [relativePath];
      }

      return [];
    }),
  );

  return files.flat().sort();
};

const resolveVaultPath = (relativePath: string): string => {
  const normalizedPath = path.posix.normalize(relativePath.replaceAll("\\", "/"));

  if (normalizedPath.startsWith("../") || path.posix.isAbsolute(normalizedPath)) {
    throw new Error("Markdown path must stay inside the local vault.");
  }

  const absolutePath = path.resolve(vaultRoot, normalizedPath);
  const relativeToRoot = path.relative(vaultRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Resolved markdown path escapes the local vault.");
  }

  return absolutePath;
};

const applyMarkdownWrite = async ({
  relativePath,
  operation,
  content,
}: MarkdownWriteRequest): Promise<string> => {
  const targetPath = resolveVaultPath(relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });

  if (operation === "create_new") {
    try {
      await readFile(targetPath, "utf8");
      throw new Error(`Refusing to overwrite existing markdown file: ${relativePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await writeFile(targetPath, `${content.trim()}\n`, "utf8");
    return relativePath;
  }

  if (operation === "overwrite") {
    await writeFile(targetPath, `${content.trim()}\n`, "utf8");
    return relativePath;
  }

  let existingContent = "";

  try {
    existingContent = await readFile(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const appendPrefix = existingContent.trim().length === 0 ? "" : "\n\n";
  const nextContent = `${existingContent}${appendPrefix}${content.trim()}\n`;
  await writeFile(targetPath, nextContent, "utf8");
  return relativePath;
};

export const createObsidianNode = (llmConnector: ILLMConnector) => {
  const writerChain = llmConnector.bindRoutingTools<MarkdownWriteRequest>(MarkdownWriteSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const latestUserRequest = getLatestUserRequest(state.messages);
      const existingFiles = await listMarkdownFiles(vaultRoot);
      const fileContext =
        existingFiles.length === 0
          ? "The vault is currently empty."
          : `Existing markdown files:\n- ${existingFiles.join("\n- ")}`;

      const writeRequest = (await writerChain.invoke([
        writerPrompt,
        new HumanMessage(
          `User request:\n${latestUserRequest}\n\n${fileContext}`,
        ),
      ])) as MarkdownWriteRequest;

      const writtenPath = await applyMarkdownWrite(writeRequest);

      return {
        messages: [
          new AIMessage(`${writeRequest.summary} Saved to ${writtenPath}.`),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown vault write error.";

      return {
        messages: [
          new AIMessage(`Unable to edit the local markdown vault: ${message}`),
        ],
      };
      }
  };
};