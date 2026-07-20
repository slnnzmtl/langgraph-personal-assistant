import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import { compactIntermediateToolHistory } from "./message-compaction.js";
import {
  DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  trimMessagesToTokenBudgetSync,
} from "./message-trimming.js";

export const ROUTE_NAMES = ["Runtime_SG", "FINISH"] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

export type AgentStateAnnotationOptions = {
  messageHistoryMaxTokens: number;
};

export const createReduceAgentMessages = (messageHistoryMaxTokens: number) => (
  left: BaseMessage[],
  right: BaseMessage | BaseMessage[],
): BaseMessage[] =>
  trimMessagesToTokenBudgetSync(
    compactIntermediateToolHistory(messagesStateReducer(left, right)),
    { maxTokens: messageHistoryMaxTokens },
  );

export const createAgentStateAnnotation = ({
  messageHistoryMaxTokens,
}: AgentStateAnnotationOptions) =>
  Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: createReduceAgentMessages(messageHistoryMaxTokens),
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

export const reduceAgentMessages = createReduceAgentMessages(DEFAULT_MESSAGE_HISTORY_MAX_TOKENS);

export const AgentStateAnnotation = createAgentStateAnnotation({
  messageHistoryMaxTokens: DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
