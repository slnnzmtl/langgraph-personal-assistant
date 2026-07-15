import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const BUILTIN_ROUTE_NAMES = ["Runtime_SG", "FINISH"] as const;
export const ROUTE_NAMES = BUILTIN_ROUTE_NAMES;
export const MESSAGE_HISTORY_LIMIT = 10;

export type RouteName = (typeof ROUTE_NAMES)[number];

/**
 * Returns a bounded history beginning at a clean semantic boundary. An active
 * assistant tool-call message and its trailing tool results are retained as one
 * atomic suffix, even when that suffix is larger than `limit`.
 */
export const trimMessagesToLast = (
  messages: BaseMessage[],
  limit = MESSAGE_HISTORY_LIMIT,
): BaseMessage[] => {
  if (messages.length <= limit) {
    return messages;
  }

  let activeToolCallIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!(message instanceof AIMessage) || !message.tool_calls?.length) {
      continue;
    }

    const toolCallIds = new Set(message.tool_calls.map((toolCall) => toolCall.id));
    const followingMessages = messages.slice(index + 1);
    const isActiveToolCall = followingMessages.every(
      (followingMessage) =>
        followingMessage instanceof ToolMessage &&
        toolCallIds.has(followingMessage.tool_call_id),
    );

    if (isActiveToolCall) {
      activeToolCallIndex = index;
      break;
    }
  }

  const startIndex = activeToolCallIndex >= 0
    ? Math.min(Math.max(0, messages.length - limit), activeToolCallIndex)
    : Math.max(0, messages.length - limit);
  let sliced = messages.slice(startIndex);

  while (sliced.length > 0 && startIndex !== activeToolCallIndex) {
    const first = sliced[0];
    const isOrphanedToolMessage = first instanceof ToolMessage;
    const isAIWithPendingToolCalls =
      first instanceof AIMessage &&
      (
        (Array.isArray(first.tool_calls) && first.tool_calls.length > 0) ||
        Boolean(
          (first as AIMessage & { additional_kwargs?: Record<string, unknown> })
            .additional_kwargs?.functionCall,
        )
      );

    if (!isOrphanedToolMessage && !isAIWithPendingToolCalls) break;
    sliced = sliced.slice(1);
  }

  return sliced;
};

export const reduceAgentMessages = (
  left: BaseMessage[],
  right: BaseMessage | BaseMessage[],
): BaseMessage[] => trimMessagesToLast(messagesStateReducer(left, right));

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  next: Annotation<RouteName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  context: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;