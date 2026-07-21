import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { extractMessageTextContent } from "../../utils/message-content.js";

export const RUNTIME_AGENT_HANDOFF_KEY = "runtimeAgentHandoff";
/** @deprecated Prefer RUNTIME_AGENT_HANDOFF_KEY */
export const EMPTY_SUBAGENT_HANDOFF_KEY = "emptySubAgentHandoff";

const MAX_TOOL_CONTEXT_CHARS = 2_000;

export type RuntimeAgentHandoffStatus = "ok" | "empty" | "max_steps" | "error";

export type RuntimeAgentHandoff = {
  kind: "runtime-agent-handoff";
  agentId: string;
  agentName: string;
  status: RuntimeAgentHandoffStatus;
  toolContext?: string;
};

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
  agentId = "runtime-agent",
): AIMessage => {
  const toolContext = formatRecentToolResultsForHandoff(messages);
  const handoff: RuntimeAgentHandoff = {
    kind: "runtime-agent-handoff",
    agentId,
    agentName,
    status: "empty",
    toolContext,
  };

  return attachRuntimeAgentHandoff(new AIMessage({ content: "" }), handoff);
};

const readHandoffPayload = (message: BaseMessage | undefined): RuntimeAgentHandoff | null => {
  if (!(message instanceof AIMessage)) {
    return null;
  }

  const kwargs = message.additional_kwargs ?? {};
  const payload = kwargs[RUNTIME_AGENT_HANDOFF_KEY];

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const status = record.status;

    if (
      record.kind === "runtime-agent-handoff"
      && typeof record.agentId === "string"
      && typeof record.agentName === "string"
      && (status === "ok" || status === "empty" || status === "max_steps" || status === "error")
    ) {
      return {
        kind: "runtime-agent-handoff",
        agentId: record.agentId,
        agentName: record.agentName,
        status,
        ...(typeof record.toolContext === "string" ? { toolContext: record.toolContext } : {}),
      };
    }
  }

  if (kwargs[EMPTY_SUBAGENT_HANDOFF_KEY] === true) {
    const responseText = extractMessageTextContent(message.content).trim();
    const toolCalls = message.tool_calls ?? [];

    if (responseText.length > 0 || toolCalls.length > 0) {
      return null;
    }

    return {
      kind: "runtime-agent-handoff",
      agentId: typeof kwargs.agentId === "string" ? kwargs.agentId : "runtime-agent",
      agentName: typeof kwargs.agentName === "string" && kwargs.agentName.trim()
        ? kwargs.agentName.trim()
        : "runtime agent",
      status: "empty",
      toolContext: typeof kwargs.toolContext === "string" ? kwargs.toolContext : "",
    };
  }

  return null;
};

export const getRuntimeAgentHandoff = (message: BaseMessage | undefined): RuntimeAgentHandoff | null =>
  readHandoffPayload(message);

export const getEmptySubAgentHandoff = (message: BaseMessage | undefined): EmptySubAgentHandoff | null => {
  const handoff = getRuntimeAgentHandoff(message);

  if (!handoff || handoff.status !== "empty") {
    return null;
  }

  return {
    agentName: handoff.agentName,
    toolContext: handoff.toolContext ?? "",
  };
};

export const attachRuntimeAgentHandoff = (
  message: AIMessage,
  handoff: RuntimeAgentHandoff,
): AIMessage => {
  const existing = message.additional_kwargs ?? {};

  return new AIMessage({
    content: message.content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    additional_kwargs: {
      ...existing,
      [RUNTIME_AGENT_HANDOFF_KEY]: handoff,
      ...(handoff.status === "empty"
        ? {
          [EMPTY_SUBAGENT_HANDOFF_KEY]: true,
          agentName: handoff.agentName,
          toolContext: handoff.toolContext ?? "",
        }
        : {}),
    },
  });
};

export const inferRuntimeAgentHandoffStatus = (
  message: AIMessage,
  agentMessages: BaseMessage[],
  stepCount: number,
  maxSteps: number,
): RuntimeAgentHandoffStatus => {
  if (stepCount >= maxSteps) {
    return "max_steps";
  }

  const responseText = extractMessageTextContent(message.content).trim();
  const toolCalls = message.tool_calls ?? [];

  if (responseText.length === 0 && toolCalls.length === 0) {
    return "empty";
  }

  if (responseText.toLowerCase().startsWith("unable to")) {
    return "error";
  }

  return "ok";
};

export const createRuntimeAgentHandoffMessage = (
  message: AIMessage,
  args: {
    agentId: string;
    agentName: string;
    agentMessages: BaseMessage[];
    stepCount: number;
    maxSteps: number;
    status?: RuntimeAgentHandoffStatus;
  },
): AIMessage => {
  const status = args.status
    ?? inferRuntimeAgentHandoffStatus(message, args.agentMessages, args.stepCount, args.maxSteps);

  return attachRuntimeAgentHandoff(message, {
    kind: "runtime-agent-handoff",
    agentId: args.agentId,
    agentName: args.agentName,
    status,
    ...(status === "empty"
      ? { toolContext: formatRecentToolResultsForHandoff(args.agentMessages) }
      : {}),
  });
};

export const applyRuntimeAgentHandoffToUpdate = (
  update: { messages: BaseMessage[] },
  args: {
    agentId: string;
    agentName: string;
    agentMessages: BaseMessage[];
    stepCount: number;
    maxSteps: number;
  },
): { messages: BaseMessage[] } => {
  if (update.messages.length === 0) {
    return { messages: update.messages };
  }

  const lastIndex = update.messages.length - 1;
  const lastMessage = update.messages[lastIndex];

  if (!(lastMessage instanceof AIMessage)) {
    return { messages: update.messages };
  }

  const messages = [...update.messages];
  messages[lastIndex] = createRuntimeAgentHandoffMessage(lastMessage, args);

  return { messages };
};

export const isEmptyAiReply = (message: BaseMessage | undefined): boolean =>
  getRuntimeAgentHandoff(message)?.status === "empty";

export const isRuntimeAgentHandoffComplete = (message: BaseMessage | undefined): boolean => {
  const handoff = getRuntimeAgentHandoff(message);
  return handoff !== null && handoff.status !== "empty";
};
