import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdir } from "node:fs/promises";

import type { StructuredToolInterface } from "@langchain/core/tools";

import type { RuntimeAgentNodeHooks, RuntimeAgentTurnContext } from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import type { SubAgentState } from "../../core/execution/sub-agent-state.js";
import { formatObsidianRoutineHint } from "../../prompts/load-system-prompt.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import { buildDirectoryTree } from "../../utils/file-system.js";
import { getAttachedSkillNames } from "../../runtime-agents/skill-attachments.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";

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

export const mapObsidianSubAgentResult = (
  result: SubAgentState,
  maxSteps: number,
  onMaxStepsExceeded: () => { messages: AIMessage[] },
): { messages: AIMessage[] } => {
  const lastMessage = result.agentMessages[result.agentMessages.length - 1];

  if (hasCompletedObsidianReply(lastMessage)) {
    return { messages: [lastMessage] };
  }

  if (hasSuccessfulObsidianWrite(result.agentMessages)) {
    return {
      messages: [new AIMessage(buildObsidianCompletionSummary(result.agentMessages))],
    };
  }

  if (result.stepCount >= maxSteps) {
    return onMaxStepsExceeded();
  }

  return {
    messages: [new AIMessage(buildObsidianCompletionSummary(result.agentMessages))],
  };
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

export const createObsidianNodeHooks = (
  vaultRoot: string,
  shellFormatters: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  const baseHooks = createRuntimeShellHooks(shellFormatters);

  return {
    beforeTurn: async () => {
      await mkdir(vaultRoot, { recursive: true });
      return null;
    },
    buildSystemPrompt: async (ctx) => {
      const vaultDirectoryTree = await buildDirectoryTree(vaultRoot);
      const basePrompt = baseHooks.buildSystemPrompt
        ? await baseHooks.buildSystemPrompt(ctx)
        : ctx.basePrompt.trim();

      const appendSections = shellFormatters.appendDynamicSections
        ?? ((staticPrompt: string, ...sections: string[]) =>
          [staticPrompt, ...sections.filter((section) => section.trim().length > 0)].join("\n\n"));

      return appendSections(
        basePrompt,
        `Vault directory tree (folders only):\n${vaultDirectoryTree}`,
        formatObsidianRoutineHint(),
      );
    },
    processResponse: (ctx, response) => {
      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];

      if (toolCalls.length > 0 || responseText.length > 0) {
        return response;
      }

      const hasToolResults = ctx.state.agentMessages.some((message) => message instanceof ToolMessage);
      if (!hasToolResults) {
        return new AIMessage("Completed the Obsidian task.");
      }

      return new AIMessage(buildObsidianCompletionSummary(ctx.state.agentMessages));
    },
  };
};
