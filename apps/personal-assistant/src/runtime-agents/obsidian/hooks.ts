import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  buildDirectoryTree,
  extractMessageTextContent,
  processBlankToolLoopResponse,
  type MapSubAgentResultOptions,
  type RuntimeAgentNodeHooks,
  type RuntimeShellFormatters,
} from "@personal-assistant/supervisor-framework";
import { getZonedDateDetails } from "../../utils/datetime.js";

const ROUTINE_NOTE_FILENAME = /^(.+?) (\d{1,2}) - .+\.md$/i;

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const toDateSortKey = (year: number, monthIndex: number, day: number): string =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const listRoutineNoteFiles = (vaultRoot: string): Array<{ relativePath: string; monthIndex: number; day: number }> => {
  const routineRoot = path.join(vaultRoot, "routine");
  if (!existsSync(routineRoot)) {
    return [];
  }

  const notes: Array<{ relativePath: string; monthIndex: number; day: number }> = [];

  for (const monthDir of readdirSync(routineRoot, { withFileTypes: true })) {
    if (!monthDir.isDirectory()) {
      continue;
    }

    const monthPath = path.join(routineRoot, monthDir.name);
    for (const file of readdirSync(monthPath, { withFileTypes: true })) {
      if (!file.isFile()) {
        continue;
      }

      const match = ROUTINE_NOTE_FILENAME.exec(file.name);
      const monthIndex = MONTH_INDEX_BY_NAME[match?.[1]?.toLowerCase() ?? ""];
      const day = Number(match?.[2]);
      if (match === null || monthIndex === undefined || !Number.isInteger(day) || day < 1 || day > 31) {
        continue;
      }

      notes.push({
        relativePath: `routine/${monthDir.name}/${file.name}`,
        monthIndex,
        day,
      });
    }
  }

  return notes;
};

const findRoutinePathForDate = (vaultRoot: string, date: Date): string | undefined => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date);
  const todayKey = `${year}-${monthNumber}-${dayNumber}`;

  return listRoutineNoteFiles(vaultRoot).find((note) =>
    toDateSortKey(Number(year), note.monthIndex, note.day) === todayKey
  )?.relativePath;
};

const findLastRoutineRelativePath = (vaultRoot: string, date: Date): string | undefined => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date);
  const todayYear = Number(year);
  const todayKey = `${year}-${monthNumber}-${dayNumber}`;

  let best: { relativePath: string; sortKey: string } | undefined;

  for (const note of listRoutineNoteFiles(vaultRoot)) {
    let sortKey = toDateSortKey(todayYear, note.monthIndex, note.day);
    if (sortKey === todayKey) {
      continue;
    }

    if (sortKey > todayKey) {
      sortKey = toDateSortKey(todayYear - 1, note.monthIndex, note.day);
    }

    if (best === undefined || sortKey > best.sortKey) {
      best = { relativePath: note.relativePath, sortKey };
    }
  }

  return best?.relativePath;
};

export const formatObsidianRoutineHint = (
  vaultRoot: string,
  date: Date = new Date(),
): string => {
  const lastRoutinePath = findLastRoutineRelativePath(vaultRoot, date);
  const todayPath = findRoutinePathForDate(vaultRoot, date);

  return [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `Last routine note: ${lastRoutinePath ?? "Not created"}`,
    `Today: ${todayPath ?? "Not created"}`,
  ].join("\n");
};

export const OBSIDIAN_COMPLETION_FALLBACK = "Completed the Obsidian task.";

const isConsumableToolBody = (content: string): boolean => {
  const trimmed = content.trim();
  return trimmed.length > 0
    && !trimmed.startsWith("[consumed:")
    && !trimmed.startsWith("Error:");
};

const resolveToolName = (
  messages: BaseMessage[],
  toolMessage: ToolMessage,
  toolIndex: number,
): string => {
  const explicitName = toolMessage.name?.trim();
  if (explicitName) {
    return explicitName;
  }

  for (let index = toolIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof AIMessage) || !message.tool_calls?.length) {
      continue;
    }

    const match = message.tool_calls.find((toolCall) => toolCall.id === toolMessage.tool_call_id);
    if (match?.name) {
      return match.name;
    }
  }

  return "";
};

/**
 * Prefer the latest useful tool payload when the model returns a blank final reply.
 * Reads win over writes/searches so "show me X" can still surface note content.
 */
export const buildObsidianCompletionSummary = (messages: BaseMessage[]): string | undefined => {
  let latestSuccess: string | undefined;
  let latestRead: string | undefined;
  let latestSearchOrList: string | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) {
      continue;
    }

    const content = extractMessageTextContent(message.content).trim();
    if (!isConsumableToolBody(content)) {
      continue;
    }

    const toolName = resolveToolName(messages, message, index);

    if (content.startsWith("Success:")) {
      latestSuccess ??= content.replace(/^Success:\s*/i, "").trim() || undefined;
      continue;
    }

    if (toolName === "read_file") {
      latestRead ??= content;
      continue;
    }

    if (
      toolName === "search_files"
      || toolName === "search_files_by_name"
      || toolName === "list_files"
    ) {
      if (
        content === "No files matched your search."
        || content === "No files or directories found."
      ) {
        continue;
      }
      latestSearchOrList ??= content;
    }
  }

  return latestRead ?? latestSuccess ?? latestSearchOrList;
};

const hasSuccessfulObsidianWrite = (messages: BaseMessage[]): boolean =>
  messages.some((message) => {
    if (!(message instanceof ToolMessage)) {
      return false;
    }

    return extractMessageTextContent(message.content).trim().startsWith("Success:");
  });

export const OBSIDIAN_RESULT_MAPPING: MapSubAgentResultOptions = {
  completionFallback: OBSIDIAN_COMPLETION_FALLBACK,
  buildSummary: buildObsidianCompletionSummary,
  isSuccessfulSideEffect: hasSuccessfulObsidianWrite,
  maxStepsMessage: ({ maxSteps }) =>
    `Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`,
  emptyHandoffWhenNoSalvage: true,
};

export const composeObsidianCapabilityHooks = (
  vaultRoot: string,
  shellFormatters: RuntimeShellFormatters,
  baseHooks: RuntimeAgentNodeHooks,
): RuntimeAgentNodeHooks => {
  const appendSections = shellFormatters.appendDynamicSections
    ?? ((staticPrompt: string, ...sections: string[]) =>
      [staticPrompt, ...sections.filter((section) => section.trim().length > 0)].join("\n\n"));

  return {
    beforeTurn: async (ctx) => {
      await mkdir(vaultRoot, { recursive: true });
      return (await baseHooks.beforeTurn?.(ctx)) ?? null;
    },
    buildSystemPrompt: async (ctx) => {
      const basePrompt = baseHooks.buildSystemPrompt
        ? await baseHooks.buildSystemPrompt(ctx)
        : ctx.basePrompt.trim();
      const vaultDirectoryTree = await buildDirectoryTree(vaultRoot);

      return appendSections(
        basePrompt,
        `Vault directory tree (folders only):\n${vaultDirectoryTree}`,
        formatObsidianRoutineHint(vaultRoot),
      );
    },
    processResponse: (ctx, response) =>
      processBlankToolLoopResponse(ctx, response, {
        completionFallback: OBSIDIAN_COMPLETION_FALLBACK,
        buildSummary: buildObsidianCompletionSummary,
      }),
    resultMapping: OBSIDIAN_RESULT_MAPPING,
  };
};
