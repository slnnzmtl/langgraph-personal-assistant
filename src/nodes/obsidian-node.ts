import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import {
  createPromptLoader,
  OBSIDIAN_SYSTEM_PROMPT_PATH,
  shouldHotReloadPrompts,
} from "../prompts/load-system-prompt.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

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

const MarkdownOperationSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite", "read", "delete"]),
  content: MarkdownContentSchema.optional(),
  summary: MarkdownSummarySchema.optional(),
});

type MarkdownOperationRequest = z.infer<typeof MarkdownOperationSchema>;

export const extractMessageTextContent = (content: BaseMessage["content"]): string => {
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
      return extractMessageTextContent(message.content);
    }
  }

  throw new Error("No user message found for markdown generation.");
};

const formatRoutineFilePath = (date: Date): string => {
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date);
  const day = date.getUTCDate();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);

  return `routine/${month}/${month} ${day} - ${weekday}.md`;
};

const formatRoutineHint = (date: Date): string => {
  const routinePath = formatRoutineFilePath(date);

  return [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `For today, use ${routinePath}.`,
  ].join(" ");
};

export const resolveVaultPath = (vaultRoot: string, relativePath: string): string => {
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

export const applyMarkdownWrite = async (
  vaultRoot: string,
  operationRequest: Extract<MarkdownOperationRequest, { operation: "create_new" | "append" | "overwrite" }>,
): Promise<string> => {
  const targetPath = resolveVaultPath(vaultRoot, operationRequest.relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });

  if (operationRequest.operation === "create_new") {
    try {
      await readFile(targetPath, "utf8");
      throw new Error(`Refusing to overwrite existing markdown file: ${operationRequest.relativePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await writeFile(targetPath, `${operationRequest.content.trim()}\n`, "utf8");
    return operationRequest.relativePath;
  }

  if (operationRequest.operation === "overwrite") {
    await writeFile(targetPath, `${operationRequest.content.trim()}\n`, "utf8");
    return operationRequest.relativePath;
  }

  let existingContent = "";

  try {
    existingContent = await readFile(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const normalizedExisting = existingContent.replace(/\s*$/, "");
  const appendPrefix = normalizedExisting.length === 0 ? "" : "\n\n";
  const nextContent = `${normalizedExisting}${appendPrefix}${operationRequest.content.trim()}\n`;
  await writeFile(targetPath, nextContent, "utf8");
  return operationRequest.relativePath;
};

export const readMarkdownFile = async (
  vaultRoot: string,
  relativePath: string,
): Promise<string> => {
  const targetPath = resolveVaultPath(vaultRoot, relativePath);

  try {
    return await readFile(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Cannot read missing markdown file: ${relativePath}`);
    }

    throw error;
  }
};

export const deleteMarkdownFile = async (
  vaultRoot: string,
  relativePath: string,
): Promise<string> => {
  const targetPath = resolveVaultPath(vaultRoot, relativePath);

  try {
    await readFile(targetPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Cannot delete missing markdown file: ${relativePath}`);
    }

    throw error;
  }

  await unlink(targetPath);
  return relativePath;
};

export const createObsidianNode = (
  llmConnector: {
    bindRoutingTools<TRoute extends Record<string, unknown>>(schema: z.ZodType<TRoute>): {
      invoke(input: unknown): Promise<TRoute>;
    };
  },
  vaultRoot: string,
) => {
  const loadObsidianPrompt = createPromptLoader(OBSIDIAN_SYSTEM_PROMPT_PATH, {
    hotReload: shouldHotReloadPrompts(),
  });
  const writerChain = llmConnector.bindRoutingTools<MarkdownOperationRequest>(MarkdownOperationSchema);

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const latestUserRequest = getLatestUserRequest(state.messages);
      const currentDate = new Date().toISOString().slice(0, 10);
      const currentTime = new Date().toISOString();
      const currentDay = new Date(`${currentDate}T00:00:00.000Z`);
      const writerPrompt = new SystemMessage(
        `${loadObsidianPrompt()}\n\nCurrent date: ${currentDate}\nCurrent time: ${currentTime}\n${formatRoutineHint(currentDay)}`,
      );

      const promptMessages = [
        writerPrompt,
        new HumanMessage(`User request:\n${latestUserRequest}`),
      ];

      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      const operationRequest = (await writerChain.invoke(promptMessages)) as MarkdownOperationRequest;

      switch (operationRequest.operation) {
        case "read": {
          if (operationRequest.content) {
            throw new Error("Read operations must not include content.");
          }

          const fileContent = await readMarkdownFile(vaultRoot, operationRequest.relativePath);

          return {
            messages: [
              new AIMessage(`Contents of ${operationRequest.relativePath}:\n\n${fileContent.trimEnd()}`),
            ],
          };
        }
        case "delete": {
          if (!operationRequest.summary) {
            throw new Error("Delete operations must include a summary.");
          }

          if (operationRequest.content) {
            throw new Error("Delete operations must not include content.");
          }

          const deletedPath = await deleteMarkdownFile(vaultRoot, operationRequest.relativePath);

          return {
            messages: [
              new AIMessage(`${operationRequest.summary} Deleted ${deletedPath}.`),
            ],
          };
        }
        case "create_new":
        case "append":
        case "overwrite": {
          if (!operationRequest.content) {
            throw new Error(`Write operations must include content for ${operationRequest.operation}.`);
          }

          if (!operationRequest.summary) {
            throw new Error(`Write operations must include a summary for ${operationRequest.operation}.`);
          }

          const writtenPath = await applyMarkdownWrite(vaultRoot, operationRequest);

          return {
            messages: [
              new AIMessage(`${operationRequest.summary} Saved to ${writtenPath}.`),
            ],
          };
        }
      }
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