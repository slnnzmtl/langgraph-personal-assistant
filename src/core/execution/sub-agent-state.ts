import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

import { createReduceAgentMessages } from "../state.js";
import { DEFAULT_MESSAGE_HISTORY_MAX_TOKENS } from "../message-trimming.js";

export type SubAgentStateAnnotationOptions = {
  messageHistoryMaxTokens: number;
};

export const createSubAgentStateAnnotation = ({
  messageHistoryMaxTokens,
}: SubAgentStateAnnotationOptions) =>
  Annotation.Root({
    agentMessages: Annotation<BaseMessage[]>({
      reducer: createReduceAgentMessages(messageHistoryMaxTokens),
      default: () => [],
    }),
    stepCount: Annotation<number>({
      reducer: (_left, right) => right,
      default: () => 0,
    }),
  });

export const SubAgentStateAnnotation = createSubAgentStateAnnotation({
  messageHistoryMaxTokens: DEFAULT_MESSAGE_HISTORY_MAX_TOKENS,
});

export type SubAgentState = typeof SubAgentStateAnnotation.State;
export type SubAgentStateUpdate = typeof SubAgentStateAnnotation.Update;
