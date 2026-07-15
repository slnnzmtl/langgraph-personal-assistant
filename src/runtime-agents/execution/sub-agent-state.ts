import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

import { reduceAgentMessages } from "../../state.js";

export const SubAgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  stepCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
});

export type SubAgentState = typeof SubAgentStateAnnotation.State;
export type SubAgentStateUpdate = typeof SubAgentStateAnnotation.Update;
