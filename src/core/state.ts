import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import { compactIntermediateToolHistory } from "./message-compaction.js";
import { trimMessagesToTokenBudgetSync } from "./message-trimming.js";

export const ROUTE_NAMES = ["Runtime_SG", "FINISH"] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

export const reduceAgentMessages = (
  left: BaseMessage[],
  right: BaseMessage | BaseMessage[],
): BaseMessage[] =>
  trimMessagesToTokenBudgetSync(
    compactIntermediateToolHistory(messagesStateReducer(left, right)),
  );

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
