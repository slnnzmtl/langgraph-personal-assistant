import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { z } from "zod";

export interface ILLMConnector {
  getModel(): BaseChatModel;
  bindRoutingTools<TRoute extends Record<string, unknown>>(
    schema: z.ZodType<TRoute>,
  ): Runnable;
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
  ): Runnable {
    return this.model.withStructuredOutput(schema, {
      name: "route_request",
    });
  }
}