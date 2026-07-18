import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const ROUTE_NAMES = ["Runtime_SG", "FINISH"] as const;
export const MESSAGE_HISTORY_LIMIT = 10;

export type RouteName = (typeof ROUTE_NAMES)[number];

/**
 * Returns a bounded history beginning at a clean semantic boundary. An active
 * assistant tool-call message and its trailing tool results are retained as one
 * atomic suffix, even when that suffix is larger than `limit`. The latest human
 * message is also retained so tool-heavy turns cannot drop the user request.
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

  let startIndex = activeToolCallIndex >= 0
    ? Math.min(Math.max(0, messages.length - limit), activeToolCallIndex)
    : Math.max(0, messages.length - limit);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] instanceof HumanMessage) {
      startIndex = Math.min(startIndex, index);
      break;
    }
  }

  let sliced = messages.slice(startIndex);

  // Only strip leading tool results whose parent AI message fell outside the window.
  // Do not strip AI messages that merely have tool_calls — completed tool rounds are valid history.
  while (sliced.length > 0 && startIndex !== activeToolCallIndex) {
    if (!(sliced[0] instanceof ToolMessage)) {
      break;
    }
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
