import type { BaseMessage } from "@langchain/core/messages";

export type PromptLoggingHook = (
  promptName: string,
  messages: BaseMessage[],
  modelResponse?: BaseMessage[] | string,
) => void | Promise<void>;

export const noopPromptLogging: PromptLoggingHook = () => {};
