import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdir } from "node:fs/promises";

import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  buildDirectoryTree,
  extractMessageTextContent,
  hasCompletedAgentReply,
  processBlankToolLoopResponse,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentTurnContext,
  type RuntimeShellFormatters,
  type SubAgentState,
} from "@personal-assistant/supervisor-framework";
import { getZonedDateDetails } from "../utils/datetime.js";
import { getAttachedSkillNames } from "@personal-assistant/supervisor-framework";

const formatRoutineFilePath = (date: Date): string => {
  const { monthName, dayNumber, weekday } = getZonedDateDetails(date);
  return `routine/${monthName}/${monthName} ${Number(dayNumber)} - ${weekday}.md`;
};

const shiftDateByDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

export const formatObsidianRoutineHint = (date: Date = new Date()): string => {
  const yesterdayPath = formatRoutineFilePath(shiftDateByDays(date, -1));
  const todayPath = formatRoutineFilePath(date);

  return [
    "Routine files live under routine/[Month]/[Month] [Day] - [Weekday].md.",
    `Yesterday: ${yesterdayPath}`,
    `Today: ${todayPath}`,
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

const hasCompletedObsidianReply = (message: BaseMessage | undefined): message is AIMessage =>
  hasCompletedAgentReply(message, OBSIDIAN_COMPLETION_FALLBACK);

export const mapObsidianSubAgentResult = (
  result: SubAgentState,
  maxSteps: number,
  onMaxStepsExceeded: () => { messages: AIMessage[] },
): { messages: AIMessage[] } => {
  const lastMessage = result.agentMessages[result.agentMessages.length - 1];

  if (hasCompletedObsidianReply(lastMessage)) {
    return { messages: [lastMessage] };
  }

  const summary = buildObsidianCompletionSummary(result.agentMessages);

  if (hasSuccessfulObsidianWrite(result.agentMessages)) {
    return { messages: [new AIMessage(summary ?? OBSIDIAN_COMPLETION_FALLBACK)] };
  }

  if (summary) {
    return { messages: [new AIMessage(summary)] };
  }

  if (result.stepCount >= maxSteps) {
    return onMaxStepsExceeded();
  }

  // Empty handoff — empty_reply / post-handoff can use toolContext when available.
  return { messages: [new AIMessage({ content: "" })] };
};

export const selectObsidianToolsForTurn = (
  ctx: RuntimeAgentTurnContext,
  toolsForTurn: StructuredToolInterface[],
): StructuredToolInterface[] => {
  const attachedSkillNames = getAttachedSkillNames(ctx.definition, ctx.state.agentMessages);
  if (attachedSkillNames.size === 0) {
    return toolsForTurn;
  }

  return toolsForTurn.filter((tool) => tool.name !== "read_skill");
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
        formatObsidianRoutineHint(),
      );
    },
    processResponse: (ctx, response) =>
      processBlankToolLoopResponse(ctx, response, {
        completionFallback: OBSIDIAN_COMPLETION_FALLBACK,
        buildSummary: buildObsidianCompletionSummary,
      }),
  };
};
