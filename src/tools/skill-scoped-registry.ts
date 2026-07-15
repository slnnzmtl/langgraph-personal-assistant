import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { extractMessageTextContent } from "../nodes/message-history.js";
import { findLastAIMessage } from "./routing.js";

export type ActiveSkillSelection = {
  skillName: string;
  args: Record<string, unknown>;
};

export type SkillToolBundle = {
  tools: StructuredToolInterface[];
};

export type SkillScopedAgentConfig = {
  readSkillTool: StructuredToolInterface;
  bundles: Map<string, SkillToolBundle>;
  defaultTools?: StructuredToolInterface[];
};

export type SkillScopedToolContext = {
  allTools: StructuredToolInterface[];
  config: SkillScopedAgentConfig;
  resolveToolsForTurn: (messages: BaseMessage[]) => StructuredToolInterface[];
};

const dedupeTools = (tools: StructuredToolInterface[]): StructuredToolInterface[] => {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) {
      return false;
    }

    seen.add(tool.name);
    return true;
  });
};

const isSuccessfulReadSkillResult = (toolMessage: ToolMessage): boolean => {
  const content = extractMessageTextContent(toolMessage.content).trim();
  return content.length > 0 && !content.startsWith("Error");
};

export const resolveActiveSkillFromHistory = (
  messages: BaseMessage[],
): ActiveSkillSelection | undefined => {
  const toolMessagesById = new Map<string, ToolMessage>();

  for (const message of messages) {
    if (message instanceof ToolMessage && message.tool_call_id) {
      toolMessagesById.set(message.tool_call_id, message);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof AIMessage)) {
      continue;
    }

    for (const call of message.tool_calls ?? []) {
      if (call.name !== "read_skill") {
        continue;
      }

      const response = call.id ? toolMessagesById.get(call.id) : undefined;
      if (!response || !isSuccessfulReadSkillResult(response)) {
        continue;
      }

      const args = (call.args ?? {}) as Record<string, unknown>;
      const skillName = typeof args.name === "string" ? args.name.trim().toLowerCase() : undefined;
      if (!skillName) {
        continue;
      }

      return { skillName, args };
    }
  }

  return undefined;
};

export const getSkillBundleTools = (
  bundles: Map<string, SkillToolBundle>,
  skillName: string,
): StructuredToolInterface[] => bundles.get(skillName.toLowerCase())?.tools ?? [];

export const formatSkillToolsPreviewBlock = (
  tools: StructuredToolInterface[],
): string | undefined => {
  if (tools.length === 0) {
    return undefined;
  }

  const lines = tools.map((tool) => `- ${tool.name}: ${tool.description}`);
  return `<available_tools>\n${lines.join("\n")}\n</available_tools>`;
};

export const appendSkillToolsPreview = (
  content: string,
  skillName: string,
  bundles: Map<string, SkillToolBundle>,
): string => {
  const previewBlock = formatSkillToolsPreviewBlock(getSkillBundleTools(bundles, skillName));
  if (!previewBlock) {
    return content;
  }

  return `${content}\n\n${previewBlock}`;
};

export const skillToolBundlesFromRecord = (
  bundles: Record<string, StructuredToolInterface[]>,
): Record<string, StructuredToolInterface[]> =>
  Object.fromEntries(
    Object.entries(bundles).map(([skillName, tools]) => [skillName.toLowerCase(), tools]),
  );

export const createSkillScopedToolContext = (
  config: SkillScopedAgentConfig,
): SkillScopedToolContext => {
  const resolveToolsForTurn = (messages: BaseMessage[]): StructuredToolInterface[] => {
    const activeSkill = resolveActiveSkillFromHistory(messages);
    if (!activeSkill) {
      return dedupeTools([config.readSkillTool, ...(config.defaultTools ?? [])]);
    }

    const bundle = config.bundles.get(activeSkill.skillName);
    if (!bundle) {
      return [config.readSkillTool];
    }

    return dedupeTools([config.readSkillTool, ...bundle.tools]);
  };

  const allTools = dedupeTools([
    config.readSkillTool,
    ...(config.defaultTools ?? []),
    ...Array.from(config.bundles.values()).flatMap((bundle) => bundle.tools),
  ]);

  return {
    allTools,
    config,
    resolveToolsForTurn,
  };
};

export const getAllowedToolNames = (
  context: SkillScopedToolContext,
  messages: BaseMessage[],
): Set<string> => new Set(context.resolveToolsForTurn(messages).map((tool) => tool.name));

export const findUnauthorizedToolCalls = (
  messages: BaseMessage[],
  allowedNames: Set<string>,
): string[] => {
  const aiMessage = findLastAIMessage(messages);
  const toolCalls = aiMessage?.tool_calls ?? [];
  const fulfilledIds = new Set(
    messages
      .filter((message): message is ToolMessage => message instanceof ToolMessage)
      .map((message) => message.tool_call_id)
      .filter(Boolean),
  );

  const unauthorized: string[] = [];

  for (const call of toolCalls) {
    if (!call.id || fulfilledIds.has(call.id)) {
      continue;
    }

    if (call.name && !allowedNames.has(call.name)) {
      unauthorized.push(call.name);
    }
  }

  return unauthorized;
};

export const createSkillScopedToolContextFromBundles = (options: {
  readSkillTool: StructuredToolInterface;
  bundles: Record<string, StructuredToolInterface[]>;
  defaultTools?: StructuredToolInterface[];
}): SkillScopedToolContext =>
  createSkillScopedToolContext({
    readSkillTool: options.readSkillTool,
    ...(options.defaultTools ? { defaultTools: options.defaultTools } : {}),
    bundles: new Map(
      Object.entries(options.bundles).map(([skillName, tools]) => [
        skillName.toLowerCase(),
        { tools },
      ]),
    ),
  });
