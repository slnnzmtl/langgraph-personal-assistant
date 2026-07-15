import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";
import { reduceAgentMessages } from "../../state.js";

export const ObsidianStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
});

export type ObsidianState = typeof ObsidianStateAnnotation.State;
export type ObsidianStateUpdate = typeof ObsidianStateAnnotation.Update;
