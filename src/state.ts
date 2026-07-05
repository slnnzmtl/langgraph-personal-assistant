import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const ROUTE_NAMES = ["Finance_SG", "Obsidian_SG", "FINISH"] as const;
export const MESSAGE_HISTORY_LIMIT = 10;
export const OBSIDIAN_MAX_STEPS = 8;

export type RouteName = (typeof ROUTE_NAMES)[number];

export type ObsidianLoopStep = {
  operation: "create_new" | "append" | "overwrite" | "read" | "delete";
  relativePath: string;
  summary?: string;
};

export type ObsidianLoopState = {
  originalUserRequest: string;
  stepCount: number;
  lastOperation?: ObsidianLoopStep;
  lastReadContent?: string;
};

/**
 * Returns the last `limit` messages, then advances the start index forward until
 * the window begins at a clean semantic boundary (HumanMessage or a plain AIMessage
 * with no pending tool calls).  This prevents a trim from orphaning a ToolMessage
 * whose paired AIMessage(functionCall) was just sliced off, which Gemini rejects.
 */
export const trimMessagesToLast = (
  messages: BaseMessage[],
  limit = MESSAGE_HISTORY_LIMIT,
): BaseMessage[] => {
  if (messages.length <= limit) {
    return messages;
  }

  let sliced = messages.slice(-limit);

  while (sliced.length > 0) {
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