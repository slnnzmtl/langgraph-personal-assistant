import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdir } from "node:fs/promises";

import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import { buildDirectoryTree } from "../../utils/file-system.js";
import {
  appendConfiguredSkillAttachments,
  getAttachedSkillNames,
} from "../../runtime-agents/skill-attachments.js";

export const buildObsidianCompletionSummary = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) {
      continue;
    }

    const content = extractMessageTextContent(message.content).trim();
    if (content.startsWith("Success:")) {
      return content.replace(/^Success:\s*/i, "").trim() || "Completed the Obsidian task.";
    }

    if (message.name === "read_file" && content.length > 0) {
      return content;
    }
  }

  return "Completed the Obsidian task.";
};

const hasSuccessfulObsidianWrite = (messages: BaseMessage[]): boolean =>
  messages.some((message) => {
    if (!(message instanceof ToolMessage)) {
      return false;
    }

    return extractMessageTextContent(message.content).trim().startsWith("Success:");
  });

const hasCompletedObsidianReply = (message: BaseMessage | undefined): message is AIMessage =>
  message instanceof AIMessage
  && !(message.tool_calls?.length)
  && extractMessageTextContent(message.content).trim().length > 0;

/**
 * Prefer a completed reply or successful write summary over a hard max-steps failure.
 * Max-steps is only reported when the loop stopped without finishing the vault edit.
 */
export const mapObsidianSubAgentResult = (
  result: { messages: BaseMessage[]; stepCount: number },
  maxSteps: number,
  onMaxStepsExceeded: () => { messages: AIMessage[] },
): { messages: AIMessage[] } => {
  const lastMessage = result.messages[result.messages.length - 1];

  if (hasCompletedObsidianReply(lastMessage)) {
    return { messages: [lastMessage] };
  }

  if (hasSuccessfulObsidianWrite(result.messages)) {
    return {
      messages: [new AIMessage(buildObsidianCompletionSummary(result.messages))],
    };
  }

  if (result.stepCount >= maxSteps) {
    return onMaxStepsExceeded();
  }

  return {
    messages: [new AIMessage(buildObsidianCompletionSummary(result.messages))],
  };
};

const resolveObsidianToolsForTurn = (
  ctx: Parameters<NonNullable<RuntimeAgentNodeHooks["resolveToolsForTurn"]>>[0],
) => {
  if (!ctx.tools) {
    return [];
  }

  let toolsForTurn = ctx.tools;

  const attachedSkillNames = getAttachedSkillNames(ctx.definition, ctx.state.messages);
  if (attachedSkillNames.size > 0) {
    toolsForTurn = toolsForTurn.filter((tool) => tool.name !== "read_skill");
  }

  return toolsForTurn;
};

export const createObsidianNodeHooks = (vaultRoot: string): RuntimeAgentNodeHooks => ({
  logLabel: "obsidian-system-prompt",
  buildErrorMessage: (error) =>
    `Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`,
  beforeTurn: async () => {
    await mkdir(vaultRoot, { recursive: true });
    return null;
  },
  buildSystemPrompt: async (ctx) => {
    const vaultDirectoryTree = await buildDirectoryTree(vaultRoot);
    const basePrompt = `${ctx.basePrompt}\n\nVault directory tree (folders only):\n${vaultDirectoryTree}`;
    return appendConfiguredSkillAttachments(basePrompt, ctx.definition, ctx.state.messages);
  },
  resolveToolsForTurn: resolveObsidianToolsForTurn,
  processResponse: (ctx, response) => {
    const responseText = extractMessageTextContent(response.content).trim();
    const toolCalls = response.tool_calls ?? [];

    if (toolCalls.length > 0 || responseText.length > 0) {
      return response;
    }

    const hasToolResults = ctx.state.messages.some((message) => message instanceof ToolMessage);
    if (!hasToolResults) {
      return new AIMessage("Completed the Obsidian task.");
    }

    return new AIMessage(buildObsidianCompletionSummary(ctx.state.messages));
  },
  emptyResponseMessage: () => "Completed the Obsidian task.",
});
