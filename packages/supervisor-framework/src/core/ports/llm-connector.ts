import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { z } from "zod";

export type RoutingChain<TRoute> = {
  invoke(input: unknown, config?: RunnableConfig): Promise<TRoute>;
};

export interface ILLMConnector {
  getModel(): BaseChatModel;
  bindRoutingTools<TRoute extends Record<string, unknown>>(
    schema: z.ZodType<TRoute>,
  ): RoutingChain<TRoute>;
}
