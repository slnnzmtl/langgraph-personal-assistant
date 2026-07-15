import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { z } from "zod";

export type RoutingChain<TRoute> = {
  invoke(input: unknown): Promise<TRoute>;
};

export interface ILLMConnector {
  getModel(): BaseChatModel;
  bindRoutingTools<TRoute extends Record<string, unknown>>(
    schema: z.ZodType<TRoute>,
  ): RoutingChain<TRoute>;
}

export class GeminiConnector implements ILLMConnector {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(apiKey: string, modelName = "gemini-1.5-flash") {
    this.model = new ChatGoogleGenerativeAI({
      apiKey,
      model: modelName,
      temperature: 0,
    });
  }

  getModel(): BaseChatModel {
    return this.model;
  }

  bindRoutingTools<TRoute extends Record<string, unknown>>(
    schema: z.ZodType<TRoute>,
  ): RoutingChain<TRoute> {
    return this.model.withStructuredOutput(schema, {
      name: "route_request",
    }) as unknown as RoutingChain<TRoute>;
  }
}