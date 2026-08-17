import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { isConsumedToolMarker } from "../message-compaction.js";
import { extractMessageTextContent } from "../message-content.js";

const MAX_TOOL_CONTEXT_CHARS = 2_000;

export type RuntimeAgentHandoffStatus = "ok" | "empty" | "max_steps" | "error";

export type RuntimeAgentHandoff = {
  kind: "runtime-agent-handoff";
  agentId: string;
  agentName: string;
  status: RuntimeAgentHandoffStatus;
  toolContext?: string;
};

const truncate = (value: string, max = MAX_TOOL_CONTEXT_CHARS): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const hasTrailingToolError = (messages: BaseMessage[]): boolean => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof ToolMessage)) {
      continue;
    }

    const body = extractMessageTextContent(message.content).trim();
    if (body.length === 0 || isConsumedToolMarker(body)) {
      continue;
    }

    return body.startsWith("Error:");
  }

  return false;
};

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
    if (body.length === 0 || isConsumedToolMarker(body)) {
      continue;
    }

    toolSnippets.unshift(`${name}: ${body}`);
    if (toolSnippets.length >= 3) {
      break;
    }
  }

  return truncate(toolSnippets.join("\n"));
};

export const resolveRuntimeAgentHandoffStatus = (
  message: AIMessage,
  stepCount: number,
  maxSteps: number,
  agentMessages: BaseMessage[] = [],
): RuntimeAgentHandoffStatus => {
  if (stepCount >= maxSteps) {
    return "max_steps";
  }

  const responseText = extractMessageTextContent(message.content).trim();
  const toolCalls = message.tool_calls ?? [];

  if (responseText.length === 0 && toolCalls.length === 0) {
    return "empty";
  }

  if (hasTrailingToolError(agentMessages)) {
    return "error";
  }

  return "ok";
};

export const buildRuntimeAgentHandoff = (args: {
  agentId: string;
  agentName: string;
  message: AIMessage;
  agentMessages: BaseMessage[];
  stepCount: number;
  maxSteps: number;
  explicitStatus?: RuntimeAgentHandoffStatus;
}): RuntimeAgentHandoff => {
  const status = args.explicitStatus
    ?? resolveRuntimeAgentHandoffStatus(
      args.message,
      args.stepCount,
      args.maxSteps,
      args.agentMessages,
    );

  const responseText = extractMessageTextContent(args.message.content).trim();
  const toolContext = formatRecentToolResultsForHandoff(args.agentMessages);

  return {
    kind: "runtime-agent-handoff",
    agentId: args.agentId,
    agentName: args.agentName,
    status,
    ...(status === "empty" || (responseText.length === 0 && toolContext.length > 0)
      ? { toolContext }
      : {}),
  };
};

export const isRuntimeAgentHandoffComplete = (
  handoff: RuntimeAgentHandoff | null | undefined,
): handoff is RuntimeAgentHandoff => handoff !== null && handoff !== undefined && handoff.status !== "empty";
