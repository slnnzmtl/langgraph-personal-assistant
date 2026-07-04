import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";

import type { ILLMConnector } from "../../src/connectors/llm-connector.js";

export class FakeRunnable<TInput, TOutput> implements Runnable {
  constructor(private readonly handler: (input: TInput) => Promise<TOutput> | TOutput) {}

  async invoke(input: TInput): Promise<TOutput> {
    return this.handler(input);
  }
}

export class FakeLLMConnector implements ILLMConnector {
  constructor(private readonly handler: (input: unknown) => unknown | Promise<unknown>) {}

  getModel() {
    throw new Error("FakeLLMConnector.getModel is not implemented for tests.");
  }

  bindRoutingTools() {
    return new FakeRunnable(async (input: unknown) => this.handler(input));
  }
}

export const latestMessageText = (messages: BaseMessage[]): string => {
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage) {
    throw new Error("No messages found.");
  }

  if (typeof lastMessage.content === "string") {
    return lastMessage.content;
  }

  return JSON.stringify(lastMessage.content);
};

export const makeHumanState = (text: string) => ({
  messages: [new HumanMessage(text)],
  context: {},
  next: undefined,
});

export const makeAiMessage = (text: string) => new AIMessage(text);