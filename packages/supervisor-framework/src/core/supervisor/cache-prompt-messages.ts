import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export const buildTurnContextMessage = (dynamicContext: string): HumanMessage | null => {
  const trimmed = dynamicContext.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return new HumanMessage(`<turn_context>\n${trimmed}\n</turn_context>`);
};

export const buildCachedRuntimePromptMessages = (
  dynamicContext: string,
  stateMessages: BaseMessage[],
): BaseMessage[] => {
  const turnContext = buildTurnContextMessage(dynamicContext);
  return turnContext ? [turnContext, ...stateMessages] : [...stateMessages];
};
