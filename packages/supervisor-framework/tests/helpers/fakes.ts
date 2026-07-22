import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

import type { ILLMConnector } from "../../src/index.js";

export class FakeLLMConnector implements ILLMConnector {
  constructor(private readonly handler: (input: unknown) => unknown) {}

  getModel(): BaseChatModel {
    return {
      invoke: async (input: unknown) => this.handler(input),
      bindTools: () => ({
        invoke: async (input: unknown) => this.handler(input),
      }),
    } as BaseChatModel;
  }

  getRoutingChain(): ReturnType<ILLMConnector["getRoutingChain"]> {
    return {
      invoke: async (input: unknown) => {
        const result = this.handler(input);
        if (result instanceof AIMessage) {
          return result;
        }

        return new AIMessage(typeof result === "string" ? result : JSON.stringify(result));
      },
    } as ReturnType<ILLMConnector["getRoutingChain"]>;
  }
}
