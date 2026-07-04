import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const ROUTE_NAMES = ["Finance_SG", "Obsidian_SG", "FINISH"] as const;
export const MESSAGE_HISTORY_LIMIT = 10;

export type RouteName = (typeof ROUTE_NAMES)[number];

export const trimMessagesToLast = (
  messages: BaseMessage[],
  limit = MESSAGE_HISTORY_LIMIT,
): BaseMessage[] => {
  if (messages.length <= limit) {
    return messages;
  }

  return messages.slice(-limit);
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