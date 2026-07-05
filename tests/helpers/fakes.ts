import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

import type { ILLMConnector, RoutingChain } from "../../src/connectors/llm-connector.js";

export class FakeRunnable<TInput, TOutput> {
  constructor(private readonly handler: (input: TInput) => Promise<TOutput> | TOutput) {}

  async invoke(input: TInput): Promise<TOutput> {
    return this.handler(input);
  }
}

export class FakeLLMConnector implements ILLMConnector {
  constructor(private readonly handler: (input: any) => any) {}

  getModel(): BaseChatModel {
    return {
      bindTools: () => ({
        invoke: async (input: any) => this.handler(input),
      }),
    } as BaseChatModel;
  }

  bindRoutingTools<TRoute extends Record<string, unknown>>(_schema: z.ZodType<TRoute>): RoutingChain<TRoute> {
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