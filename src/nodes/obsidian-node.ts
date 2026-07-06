import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logSystemPromptInvocation } from "../logging/system-prompt-logger.js";
import {
  loadObsidianSystemPrompt,
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
  content: MarkdownContentSchema,
  summary: MarkdownSummarySchema,
});

export const extractMessageTextContent = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") return content.replaceAll("\\n", "\n");
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
      .join("\n")
      .replaceAll("\\n", "\n");
  }
  return JSON.stringify(content);
};

export const cleanHistoryForGemini = (messages: BaseMessage[]): BaseMessage[] => {
  const result: BaseMessage[] = [];
  
  for (const msg of messages) {
    if (result.length === 0) {
      result.push(msg);
      continue;
    }
    
    const lastMsg = result[result.length - 1];
    if (!lastMsg) {
      result.push(msg);
      continue;
    }

    const getMsgType = (m: any) => typeof m.getType === "function" ? m.getType() : m._getType();
    const msgType = getMsgType(msg);
    const lastMsgType = getMsgType(lastMsg);

    if (msgType === "ai" && lastMsgType === "ai") {
      const currentContent = extractMessageTextContent(lastMsg.content);
      const nextContent = extractMessageTextContent(msg.content);
      const lastAiMsg = lastMsg as AIMessage;
      
      result[result.length - 1] = new AIMessage({
        content: `${currentContent}\n${nextContent}`.trim(),
        ...(lastAiMsg.additional_kwargs ? { additional_kwargs: lastAiMsg.additional_kwargs } : {}),
        ...(lastMsg.response_metadata ? { response_metadata: lastMsg.response_metadata } : {}),
        ...(lastAiMsg.tool_calls ? { tool_calls: lastAiMsg.tool_calls } : {}),
      });
      continue;
    }
    
    if (msgType === "human" && lastMsgType === "human") {
      const currentContent = extractMessageTextContent(lastMsg.content);
      const nextContent = extractMessageTextContent(msg.content);
      
      result[result.length - 1] = new HumanMessage({
        content: `${currentContent}\n${nextContent}`.trim(),
        ...(lastMsg.additional_kwargs ? { additional_kwargs: lastMsg.additional_kwargs } : {}),
      });
      continue;
    }
    
    result.push(msg);
  }
  return result;
};

const hasAnyToolCalls = (message: BaseMessage): boolean => {
  if (!(message instanceof AIMessage)) return false;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
  const kwargs = (message as AIMessage & { additional_kwargs?: Record<string, unknown> }).additional_kwargs;
  return Boolean(kwargs?.functionCall);
};

const getLatestToolCallMessage = (messages: BaseMessage[]): AIMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage && hasAnyToolCalls(message)) {
      return message;
    }
  }
  return undefined;
};

const getTrailingToolMessagesCount = (messages: BaseMessage[]): number => {
  let count = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message instanceof ToolMessage) {
      count += 1;
      continue;
    }

    if (message instanceof AIMessage && hasAnyToolCalls(message)) {
      return count;
    }

    if (count > 0) {
      break;
    }
  }

  return count;
};

const getLatestToolCallName = (messages: BaseMessage[]): string | undefined => {
  return getLatestToolCallMessage(messages)?.tool_calls?.at(-1)?.name;
};

const OBSIDIAN_TOOL_STEP_COUNT_KEY = "obsidianToolStepCount";

const getObsidianToolStepCount = (state: AgentState): number => {
  const value = state.context[OBSIDIAN_TOOL_STEP_COUNT_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const getFormatterPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string => {
  return parts.find((entry) => entry.type === type)?.value ?? "";
};

const getZonedDateDetails = (date: Date, timeZone: string) => {
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, hourCycle: "h23" }).formatToParts(date);
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
  return `Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md. For today, use ${formatRoutineFilePath(date, timeZone)}.`;
};

const formatCurrentDate = (date: Date, timeZone: string): string => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date, timeZone);
  return `${year}-${monthNumber}-${dayNumber}`;
};

const formatCurrentTime = (date: Date, timeZone: string): string => {
  const { year, monthNumber, dayNumber, hour, minute, second } = getZonedDateDetails(date, timeZone);
  return `${year}-${monthNumber}-${dayNumber}T${hour}:${minute}:${second} ${timeZone}`;
};

const checkMarkdownExists = async (vaultRoot: string, relativePath: string): Promise<boolean> => {
  try {
    await readFile(resolveVaultPath(vaultRoot, relativePath), "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

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

export const createObsidianNode = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
  appTimezone: string,
) => {
  const model = llmConnector.getModel();

  if (typeof model.bindTools !== "function") throw new Error("Obsidian tool-bound model must support tool calling.");
  const modelWithTools = model.bindTools(createObsidianTools(vaultRoot));

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const stepCount = getObsidianToolStepCount(state);
      const lastMessage = state.messages[state.messages.length - 1];
      const latestToolCallMessage = getLatestToolCallMessage(state.messages);
      const latestToolCallName = getLatestToolCallName(state.messages);

      if (lastMessage instanceof ToolMessage) {
        const contentStr = extractMessageTextContent(lastMessage.content);
        const isSuccessResult = contentStr.startsWith("Success:");
        const toolCallCount = latestToolCallMessage?.tool_calls?.length
          ?? (latestToolCallMessage && hasAnyToolCalls(latestToolCallMessage) ? 1 : 0);
        const handledToolMessages = getTrailingToolMessagesCount(state.messages);
        const isTerminalWriteTool = latestToolCallName === "write_markdown_file";

        if (isSuccessResult && isTerminalWriteTool && toolCallCount > 0 && handledToolMessages >= toolCallCount) {
          return {
            messages: [new AIMessage(extractMessageTextContent(lastMessage.content).replace(/^(Success|Notice):\s*/u, ""))],
            context: {
              [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0,
              obsidianHandoff: true,
            },
          };
        }
      }

      if (stepCount >= OBSIDIAN_MAX_STEPS) {
        return {
          messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${OBSIDIAN_MAX_STEPS} Obsidian tool steps.`)],
          context: { [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0 },
        };
      }

      const now = new Date();
      const writerPrompt = new SystemMessage(
        `${loadObsidianSystemPrompt()}\nNow: ${formatCurrentTime(now, appTimezone)}\n${formatRoutineHint(now, appTimezone)}\n\nTreat the current date above as authoritative.`
      );

      const sanitizedHistory = cleanHistoryForGemini(state.messages);

      const promptMessages = [writerPrompt, ...sanitizedHistory];
      
      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) throw new Error("Obsidian tool-bound model must return an AI message.");

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      let finalMessage: AIMessage = response;
      if (!hasToolCalls && responseText.length === 0) {
        finalMessage = new AIMessage("Completed the Obsidian task.");
      }

      return {
        messages: [finalMessage],
        context: {
          [OBSIDIAN_TOOL_STEP_COUNT_KEY]: hasToolCalls ? stepCount + 1 : 0,
          obsidianHandoff: !hasToolCalls,
        },
      };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
        context: { [OBSIDIAN_TOOL_STEP_COUNT_KEY]: 0 },
      };
    }
  };
};