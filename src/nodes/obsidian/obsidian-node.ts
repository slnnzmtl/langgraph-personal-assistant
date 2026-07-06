import { AIMessage, SystemMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { mkdir } from "node:fs/promises";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import {
  loadObsidianSystemPrompt,
} from "../../prompts/load-system-prompt.js";
import { extractMessageTextContent } from "../message-history.js";
import { type AgentState, type AgentStateUpdate } from "../../state.js";
import {
  createObsidianTools,
} from "./obsidian-tools.js";

export const createObsidianNode = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
  appTimezone: string,
) => {
  const model = llmConnector.getModel();

  if (typeof model.bindTools !== "function") throw new Error("Obsidian tool-bound model must support tool calling.");
  const modelWithTools = model.bindTools(createObsidianTools(vaultRoot));

  return async (state: AgentState): Promise<AgentStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const systemInstructions = new SystemMessage(loadObsidianSystemPrompt());

      const promptMessages = mergeMessageRuns([systemInstructions, ...state.messages]);
      
      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) throw new Error("Obsidian tool-bound model must return an AI message.");

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      let finalMessage: AIMessage = response;
      if (!hasToolCalls && responseText.length === 0) {
        finalMessage = new AIMessage("Completed the Obsidian task.");
      }

      return {
        messages: [finalMessage],
      };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
      };
    }
  };
};
