import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type {
  BindRoutingToolsOptions,
  ILLMConnector,
  RoutingChain,
} from "@personal-assistant/supervisor-framework";

export class GeminiConnector implements ILLMConnector {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(apiKey: string, modelName = "gemini-2.5-flash-lite") {
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
    schema: Parameters<ILLMConnector["bindRoutingTools"]>[0],
    options?: BindRoutingToolsOptions,
  ): RoutingChain<TRoute> {
    const model = (options?.model ?? this.model) as ChatGoogleGenerativeAI;
    return model.withStructuredOutput(schema, {
      name: "route_request",
    }) as unknown as RoutingChain<TRoute>;
  }
}
