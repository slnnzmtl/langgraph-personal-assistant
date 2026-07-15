import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { reduceAgentMessages } from "../../state.js";

export const FinanceStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  financeStepCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
});

export type FinanceState = typeof FinanceStateAnnotation.State;
export type FinanceStateUpdate = typeof FinanceStateAnnotation.Update;
