import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { z } from "zod";

export type RoutingChain<TRoute> = {
  invoke(input: unknown, config?: RunnableConfig): Promise<TRoute>;
};

export type BindRoutingToolsOptions = {
  /** When set, structured routing runs against this model (e.g. a Gemini cached-content client). */
  model?: BaseChatModel;
};

export interface ILLMConnector {
  getModel(): BaseChatModel;
  bindRoutingTools<TRoute extends Record<string, unknown>>(
    schema: z.ZodType<TRoute>,
    options?: BindRoutingToolsOptions,
  ): RoutingChain<TRoute>;
};
