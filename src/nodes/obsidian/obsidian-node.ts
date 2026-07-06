import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { tool } from "@langchain/core/tools";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import {
  loadObsidianSystemPrompt,
} from "../../prompts/load-system-prompt.js";
import { extractMessageTextContent } from "../message-history.js";
import { type AgentState, type AgentStateUpdate } from "../../state.js";
import {
  ReadMarkdownToolSchema,
  WriteMarkdownToolSchema,
  applyMarkdownWrite,
  checkMarkdownExists,
  readMarkdownFile,
} from "./obsidian-vault.js";



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


const formatCurrentTime = (date: Date, timeZone: string): string => {
  const { year, monthNumber, dayNumber, hour, minute, second } = getZonedDateDetails(date, timeZone);
  return `${year}-${monthNumber}-${dayNumber}T${hour}:${minute}:${second} ${timeZone}`;
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

      const now = new Date();
      const systemInstructions = new SystemMessage(
        `${loadObsidianSystemPrompt()}\nNow: ${formatCurrentTime(now, appTimezone)}\n${formatRoutineHint(now, appTimezone)}\n\nTreat the current date above as authoritative.`
      );

      const promptMessages = [systemInstructions, ...state.messages];
      
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
      };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
      };
    }
  };
};
