import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../../utils/message-content.js";

export const EMPTY_SUBAGENT_HANDOFF_KEY = "emptySubAgentHandoff";

const MAX_TOOL_CONTEXT_CHARS = 2_000;

export type EmptySubAgentHandoff = {
  agentName: string;
  toolContext: string;
};

const truncate = (value: string, max = MAX_TOOL_CONTEXT_CHARS): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const formatRecentToolResultsForHandoff = (messages: BaseMessage[]): string => {
  const toolSnippets: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) {
      if (toolSnippets.length > 0) {
        break;
      }
      continue;
    }

    const name = message.name?.trim() || "tool";
    const body = extractMessageTextContent(message.content).trim();
    if (body.length === 0) {
      continue;
    }

    toolSnippets.unshift(`${name}: ${body}`);
    if (toolSnippets.length >= 3) {
      break;
    }
  }

  return truncate(toolSnippets.join("\n"));
};

export const createEmptySubAgentHandoffMessage = (
  messages: BaseMessage[],
  agentName: string,
): AIMessage =>
  new AIMessage({
    content: "",
    additional_kwargs: {
      [EMPTY_SUBAGENT_HANDOFF_KEY]: true,
      agentName,
      toolContext: formatRecentToolResultsForHandoff(messages),
    },
  });

export const getEmptySubAgentHandoff = (message: BaseMessage | undefined): EmptySubAgentHandoff | null => {
  if (!(message instanceof AIMessage)) {
    return null;
  }

  const kwargs = message.additional_kwargs ?? {};
  if (kwargs[EMPTY_SUBAGENT_HANDOFF_KEY] !== true) {
    return null;
  }

  const responseText = extractMessageTextContent(message.content).trim();
  const toolCalls = message.tool_calls ?? [];
  if (responseText.length > 0 || toolCalls.length > 0) {
    return null;
  }

  return {
    agentName: typeof kwargs.agentName === "string" && kwargs.agentName.trim()
      ? kwargs.agentName.trim()
      : "runtime agent",
    toolContext: typeof kwargs.toolContext === "string" ? kwargs.toolContext : "",
  };
};

export const isEmptyAiReply = (message: BaseMessage | undefined): boolean => {
  if (!(message instanceof AIMessage)) {
    return false;
  }

  const responseText = extractMessageTextContent(message.content).trim();
  const toolCalls = message.tool_calls ?? [];
  return responseText.length === 0 && toolCalls.length === 0;
};
