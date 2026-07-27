import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import type { RuntimeAgentHandoff, RuntimeAgentHandoffStatus } from "./execution/runtime-agent-handoff.js";
import type { ExecutionStep } from "./supervisor/routing-schema.js";
import { compactIntermediateToolHistory } from "./message-compaction.js";
import {
  DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
  trimMessagesToTokenBudgetSync,
} from "./message-trimming.js";

export const FINISH_ROUTE = "FINISH" as const;
export const EMPTY_REPLY_ROUTE = "empty_reply" as const;
export const FAILURE_REPLY_ROUTE = "failure_reply" as const;
export const POST_HANDOFF_FINISH_ROUTE = "post_handoff_finish" as const;

/** Remaining execution steps after the current `next` route. Future parallel work may widen step shape. */
export type ExecutionQueue = ExecutionStep[];

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
    agentMessages: Annotation<BaseMessage[]>({
      reducer: createReduceAgentMessages(messageHistoryMaxTokens),
      default: () => [],
    }),
    stepCount: Annotation<number>({
      reducer: (_left, right) => right,
      default: () => 0,
    }),
    next: Annotation<string | undefined>({
      reducer: (_left, right) => right,
      default: () => undefined,
    }),
    executionQueue: Annotation<ExecutionQueue>({
      reducer: (_left, right) => right ?? [],
      default: () => [],
    }),
    delegationPrompt: Annotation<string | null>({
      reducer: (_left, right) => right ?? null,
      default: () => null,
    }),
    context: Annotation<Record<string, unknown>>({
      reducer: (left, right) => ({ ...left, ...right }),
      default: () => ({}),
    }),
    lastHandoff: Annotation<RuntimeAgentHandoff | null>({
      reducer: (_left, right) => right ?? null,
      default: () => null,
    }),
    handoffStatus: Annotation<RuntimeAgentHandoffStatus | undefined>({
      reducer: (_left, right) => right,
      default: () => undefined,
    }),
    routingFailureContext: Annotation<string | null>({
      reducer: (_left, right) => right ?? null,
      default: () => null,
    }),
    retryCount: Annotation<number>({
      reducer: (_left, right) => right ?? 0,
      default: () => 0,
    }),
  });

export const reduceAgentMessages = createReduceAgentMessages(DEFAULT_MESSAGE_HISTORY_MAX_TOKENS);

export const AgentStateAnnotation = createAgentStateAnnotation({
  messageHistoryMaxTokens: DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
