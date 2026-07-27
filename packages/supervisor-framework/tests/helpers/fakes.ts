import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { z } from "zod";

import type { ILLMConnector, RoutingChain } from "../../src/index.js";

export class FakeLLMConnector implements ILLMConnector {
  constructor(private readonly handler: (input: unknown) => unknown) {}

  getModel(): BaseChatModel {
    return {
      invoke: async (input: unknown) => this.handler(input),
      bindTools: () => ({
        invoke: async (input: unknown) => this.handler(input),
      }),
    } as unknown as BaseChatModel;
  }

  bindRoutingTools<TRoute extends Record<string, unknown>>(_schema: z.ZodType<TRoute>): RoutingChain<TRoute> {
    return {
      invoke: async (input: unknown) => {
        const result = this.handler(input);
        if (result instanceof AIMessage) {
          return result as unknown as TRoute;
        }

        return (typeof result === "string" ? result : JSON.stringify(result)) as unknown as TRoute;
      },
    };
  }
}
