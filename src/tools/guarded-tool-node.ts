import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import type { SubAgentState, SubAgentStateUpdate } from "../core/execution/sub-agent-state.js";
import {
  findUnauthorizedToolCalls,
  getAllowedToolNames,
  type SkillScopedToolContext,
} from "./skill-scoped-registry.js";
import { findLastAIMessage } from "./routing.js";

const buildUnauthorizedToolMessages = (
  messages: BaseMessage[],
  unauthorizedToolNames: string[],
): ToolMessage[] => {
  const aiMessage = findLastAIMessage(messages);
  const toolCalls = aiMessage?.tool_calls ?? [];
  const fulfilledIds = new Set(
    messages
      .filter((message): message is ToolMessage => message instanceof ToolMessage)
      .map((message) => message.tool_call_id)
      .filter(Boolean),
  );

  const messagesToReturn: ToolMessage[] = [];

  for (const call of toolCalls) {
    if (!call.id || fulfilledIds.has(call.id) || !call.name) {
      continue;
    }

    if (!unauthorizedToolNames.includes(call.name)) {
      continue;
    }

    messagesToReturn.push(
      new ToolMessage({
        name: call.name,
        tool_call_id: call.id,
        content: `Error: Tool "${call.name}" is not available until the matching skill is loaded via read_skill.`,
      }),
    );
  }

  return messagesToReturn;
};

export const createGuardedToolNode = (context: SkillScopedToolContext) => {
  const baseToolNode = new ToolNode(context.allTools);

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    const allowedNames = getAllowedToolNames(context, state.messages);
    const unauthorized = findUnauthorizedToolCalls(state.messages, allowedNames);

    if (unauthorized.length > 0) {
      return {
        messages: buildUnauthorizedToolMessages(state.messages, unauthorized),
      };
    }

    return baseToolNode.invoke(state);
  };
};

export const createStaticToolNode = (tools: StructuredToolInterface[]) =>
  new ToolNode(tools).invoke.bind(new ToolNode(tools));
