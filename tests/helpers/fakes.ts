import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

import type { RoutingChain } from "../../src/connectors/llm-connector.js";

export class FakeRunnable<TInput, TOutput> {
  constructor(private readonly handler: (input: TInput) => Promise<TOutput> | TOutput) {}

  async invoke(input: TInput): Promise<TOutput> {
    return this.handler(input);
  }
}

export class FakeLLMConnector {
  constructor(private readonly handler: (input: any) => any) {}

  getModel(): any {
    throw new Error("FakeLLMConnector.getModel is not implemented for tests.");
  }

  bindRoutingTools<TRoute extends Record<string, unknown>>(): RoutingChain<TRoute> {
    return new FakeRunnable(async (input: any) => this.handler(input)) as RoutingChain<TRoute>;
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