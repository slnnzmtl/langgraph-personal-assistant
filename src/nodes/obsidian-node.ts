import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import {
  createPromptLoader,
  OBSIDIAN_SYSTEM_PROMPT_PATH,
  shouldHotReloadPrompts,
} from "../prompts/load-system-prompt.js";
import { OBSIDIAN_MAX_STEPS, type AgentState, type AgentStateUpdate } from "../state.js";

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

const ReadMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
});

const WriteMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  operation: z.enum(["create_new", "append", "overwrite"]),
  content: MarkdownContentSchema.optional(),
  summary: MarkdownSummarySchema,
});

const DeleteMarkdownToolSchema = z.object({
  relativePath: MarkdownRelativePathSchema,
  summary: MarkdownSummarySchema,
});

type MarkdownWriteOperation = {
  relativePath: string;
  operation: "create_new" | "append" | "overwrite";
  content?: string;
  summary?: string;
};

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

const formatTerminalToolResponse = (content: BaseMessage["content"]): string => {
  return extractMessageTextContent(content).replace(/^(Success|Notice):\s*/u, "");
};

const OBSIDIAN_TOOL_STEP_COUNT_KEY = "obsidianToolStepCount";
const OBSIDIAN_ORIGINAL_REQUEST_KEY = "obsidianOriginalRequest";

const writeIntentPattern = /\b(create|save|write|append|overwrite|update|move|copy|add|document|log|record)\b/i;

const getObsidianToolStepCount = (state: AgentState): number => {
  const value = state.context[OBSIDIAN_TOOL_STEP_COUNT_KEY];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const getLatestToolCallMessage = (messages: BaseMessage[]): AIMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message instanceof AIMessage
      && Array.isArray(message.tool_calls)
      && message.tool_calls.length > 0
    ) {
      return message;
    }
  }

  return undefined;
};

const getLatestToolResultMessage = (messages: BaseMessage[]): ToolMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message instanceof ToolMessage) {
      return message;
    }
  }

  return undefined;
};

const getLatestToolCallName = (messages: BaseMessage[]): string | undefined => {
  const lastToolCallMessage = getLatestToolCallMessage(messages);
  return lastToolCallMessage?.tool_calls?.[0]?.name;
};

const formatObsidianLoopContext = (state: AgentState): string => {
  const originalUserRequest = getOriginalUserRequest(state);
  const lastToolCallMessage = getLatestToolCallMessage(state.messages);
  const lastToolCall = lastToolCallMessage?.tool_calls?.[0];
  const lastToolResult = getLatestToolResultMessage(state.messages);
  const stepCount = getObsidianToolStepCount(state);
  const loopLines = [
    "Obsidian loop context:",
    `- Original user request: ${originalUserRequest}`,
    `- Completed tool steps so far: ${stepCount}`,
  ];

  if (!lastToolCall) {
    loopLines.push("- No prior Obsidian tool step has completed yet.");
    return loopLines.join("\n");
  }

  const relativePath = typeof lastToolCall.args?.relativePath === "string"
    ? lastToolCall.args.relativePath
    : "unknown path";

  loopLines.push(`- Last tool call: ${lastToolCall.name} on ${relativePath}.`);

  if (lastToolResult) {
    loopLines.push("- Latest tool result:");
    loopLines.push(extractMessageTextContent(lastToolResult.content));
  }

  if (writeIntentPattern.test(originalUserRequest) && lastToolCall.name === "read_markdown_file") {
    loopLines.push(
      "- The user request still requires a markdown write step. Do not finish yet. Your next response must call write_markdown_file unless the read result proves the request is impossible.",
    );
  }

  return loopLines.join("\n");
};

const findLatestUserRequest = (messages: BaseMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message instanceof HumanMessage) {
      return extractMessageTextContent(message.content);
    }
  }

  return undefined;
};

const getOriginalUserRequest = (state: AgentState): string => {
  const latestUserRequest = findLatestUserRequest(state.messages);

  if (latestUserRequest) {
    return latestUserRequest;
  }

  const persistedRequest = state.context[OBSIDIAN_ORIGINAL_REQUEST_KEY];

  if (typeof persistedRequest === "string" && persistedRequest.length > 0) {
    return persistedRequest;
  }

  throw new Error("No user message found for markdown generation.");
};

const getFormatterPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string => {
  const part = parts.find((entry) => entry.type === type);

  if (!part) {
    throw new Error(`Missing formatted date part: ${type}`);
  }

  return part.value;
};

const getZonedDateDetails = (date: Date, timeZone: string) => {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    year: getFormatterPart(dateParts, "year"),
    monthNumber: getFormatterPart(dateParts, "month"),
    dayNumber: getFormatterPart(dateParts, "day"),
    weekday: getFormatterPart(dateParts, "weekday"),
    monthName: new Intl.DateTimeFormat("en-US", { month: "long", timeZone }).format(date),
    hour: getFormatterPart(timeParts, "hour"),
    minute: getFormatterPart(timeParts, "minute"),
    second: getFormatterPart(timeParts, "second"),
  };
};

const formatRoutineFilePath = (date: Date, timeZone: string): string => {
  const { monthName, dayNumber, weekday } = getZonedDateDetails(date, timeZone);

  return `routine/${monthName}/${monthName} ${Number(dayNumber)} - ${weekday}.md`;
};

const formatRoutineHint = (date: Date, timeZone: string): string => {
  const routinePath = formatRoutineFilePath(date, timeZone);

  return [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `For today, use ${routinePath}.`,
  ].join(" ");
};

const formatCurrentDate = (date: Date, timeZone: string): string => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date, timeZone);

  return `${year}-${monthNumber}-${dayNumber}`;
};

const formatCurrentTime = (date: Date, timeZone: string): string => {
  const { year, monthNumber, dayNumber, hour, minute, second } = getZonedDateDetails(date, timeZone);

  return `${year}-${monthNumber}-${dayNumber}T${hour}:${minute}:${second} ${timeZone}`;
};

const addDays = (date: Date, days: number): Date => {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
};

const checkMarkdownExists = async (vaultRoot: string, relativePath: string): Promise<boolean> => {
  try {
    await readFile(resolveVaultPath(vaultRoot, relativePath), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const formatRoutineAvailabilityHint = async (vaultRoot: string, date: Date, timeZone: string): Promise<string> => {
  const routineChecks = await Promise.all([
    { label: "Yesterday", path: formatRoutineFilePath(addDays(date, -1), timeZone) },
    { label: "Today", path: formatRoutineFilePath(date, timeZone) },
    { label: "Tomorrow", path: formatRoutineFilePath(addDays(date, 1), timeZone) },
  ].map(async ({ label, path: relativePath }) => ({
    label,
    relativePath,
    exists: await checkMarkdownExists(vaultRoot, relativePath),
  })));

  return [
    "Routine note availability:",
    ...routineChecks.map(({ label, relativePath, exists }) =>
      `- ${label}: ${exists ? "exists" : "missing"} at ${relativePath}`),
  ].join("\n");
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
  operationRequest: MarkdownWriteOperation,
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

    const nextContent = operationRequest.content?.trim() ?? "";
    await writeFile(targetPath, nextContent.length === 0 ? "" : `${nextContent}\n`, "utf8");
    return operationRequest.relativePath;
  }

  if (operationRequest.operation === "overwrite") {
    const nextContent = operationRequest.content?.trim();

    if (!nextContent) {
      throw new Error("Overwrite operations must include content.");
    }

    await writeFile(targetPath, `${nextContent}\n`, "utf8");
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
  const appendContent = operationRequest.content?.trim();

  if (!appendContent) {
    throw new Error("Append operations must include content.");
  }

  const nextContent = `${normalizedExisting}${appendPrefix}${appendContent}\n`;
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

export const createObsidianTools = (vaultRoot: string) => [
  tool(
    async ({ relativePath }) => {
      return readMarkdownFile(vaultRoot, relativePath);
    },
    {
      name: "read_markdown_file",
      description: "Read the contents of an existing markdown file in the local vault.",
      schema: ReadMarkdownToolSchema,
    },
  ),
  tool(
    async ({ relativePath, operation, content, summary }) => {

      if (operation === "create_new") {
        const exists = await checkMarkdownExists(vaultRoot, relativePath);

        if (exists) {
          if (content?.trim()) {
            await applyMarkdownWrite(vaultRoot, {
              relativePath,
              operation: "append",
              content,
              summary,
            });

            return `Success: ${summary} Saved to ${relativePath}.`;
          }

          return `Notice: File already exists at ${relativePath}.`;
        }
      }

      await applyMarkdownWrite(vaultRoot, {
        relativePath,
        operation,
        summary,
        ...(content ? { content } : {}),
      });

      return `Success: ${summary} Saved to ${relativePath}.`;
    },
    {
      name: "write_markdown_file",
      description: "Create, append to, or overwrite a markdown file in the local vault.",
      schema: WriteMarkdownToolSchema,
    },
  ),
  tool(
    async ({ relativePath, summary }) => {
      await deleteMarkdownFile(vaultRoot, relativePath);
      return `Success: ${summary} Deleted ${relativePath}.`;
    },
    {
      name: "delete_markdown_file",
      description: "Delete a markdown file from the local vault.",
      schema: DeleteMarkdownToolSchema,
    },
  ),
];

export const createObsidianNode = (
  llmConnector: {
    getModel(): BaseChatModel;
  },
  vaultRoot: string,
  appTimezone: string,
) => {
  const loadObsidianPrompt = createPromptLoader(OBSIDIAN_SYSTEM_PROMPT_PATH, {
    hotReload: shouldHotReloadPrompts(),
  });
  const model = llmConnector.getModel();

  if (typeof model.bindTools !== "function") {
    throw new Error("Obsidian tool-bound model must support tool calling.");
  }

  const modelWithTools = model.bindTools(createObsidianTools(vaultRoot));

  const looksLikeClarification = (text: string): boolean => {
    const normalized = text.toLowerCase();

    return (
      normalized.includes("current date") ||
      normalized.includes("what is") ||
      normalized.includes("can you clarify") ||
      normalized.endsWith("?")
    );
  };

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const stepCount = getObsidianToolStepCount(state);
      const originalUserRequest = getOriginalUserRequest(state);
      const lastMessage = state.messages[state.messages.length - 1];
      const latestToolCallName = getLatestToolCallName(state.messages);

      if (lastMessage instanceof ToolMessage) {
        const shouldContinueAfterRead = latestToolCallName === "read_markdown_file"
          && writeIntentPattern.test(originalUserRequest);

        if (!shouldContinueAfterRead) {
          return {
            messages: [new AIMessage(formatTerminalToolResponse(lastMessage.content))],
            context: {
              [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0,
              [OBSIDIAN_ORIGINAL_REQUEST_KEY]: originalUserRequest,
            },
          };
        }
      }

      if (stepCount >= OBSIDIAN_MAX_STEPS) {
        return {
          messages: [
            new AIMessage(
              `Unable to edit the local markdown vault: exceeded the maximum of ${OBSIDIAN_MAX_STEPS} Obsidian tool steps.`,
            ),
          ],
          context: {
            [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0,
            [OBSIDIAN_ORIGINAL_REQUEST_KEY]: originalUserRequest,
          },
        };
      }

      const now = new Date();
      const currentDate = formatCurrentDate(now, appTimezone);
      const currentTime = formatCurrentTime(now, appTimezone);
      const routineAvailabilityHint = await formatRoutineAvailabilityHint(vaultRoot, now, appTimezone);
      const loopContext = formatObsidianLoopContext(state);
      const writerPrompt = new SystemMessage(
        `${loadObsidianPrompt()}\nNow: ${currentTime}\n${formatRoutineHint(now, appTimezone)}\n${routineAvailabilityHint}\n\n${loopContext}\n\nTreat the current date above as authoritative. Do not ask the user for today's date. Use the injected current date and current time when deciding which routine note to read or create. You have direct access to filesystem tools. Use them one step at a time when a task requires reading, writing, or deleting markdown. Continue using tools until the task is complete, then answer clearly.`,
      );

      const promptMessages = [writerPrompt, ...state.messages];

      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) {
        throw new Error("Obsidian tool-bound model must return an AI message.");
      }

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!hasToolCalls && looksLikeClarification(responseText)) {
        return {
          messages: [
            new AIMessage(
              "Unable to edit the local markdown vault: the Obsidian model requested clarification instead of using the injected date and filesystem tools.",
            ),
          ],
          context: {
            [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0,
            [OBSIDIAN_ORIGINAL_REQUEST_KEY]: originalUserRequest,
          },
        };
      }

      const finalMessage = hasToolCalls || responseText.length > 0
        ? response
        : new AIMessage("Completed the Obsidian task.");

      return {
        messages: [finalMessage],
        context: {
          [OBSIDIAN_TOOL_STEP_COUNT_KEY]: hasToolCalls ? stepCount + 1 : 0,
          [OBSIDIAN_ORIGINAL_REQUEST_KEY]: originalUserRequest,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown vault write error.";
      const latestUserRequest = findLatestUserRequest(state.messages);

      return {
        messages: [
          new AIMessage(`Unable to edit the local markdown vault: ${message}`),
        ],
        context: {
          [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0,
          ...(latestUserRequest ? { [OBSIDIAN_ORIGINAL_REQUEST_KEY]: latestUserRequest } : {}),
        },
      };
    }
  };
};