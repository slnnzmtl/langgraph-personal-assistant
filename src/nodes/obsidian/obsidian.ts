import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
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

      // Early return on successful write operations — extract summary and skip LLM re-invocation
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage instanceof ToolMessage && lastMessage.name === "write_markdown_file") {
        const toolContent = typeof lastMessage.content === "string" ? lastMessage.content : String(lastMessage.content);
        if (toolContent.startsWith("Success:")) {
          // Parse "Success: {summary} saved to {path}." → extract just the summary part
          const match = toolContent.match(/^Success:\s*(.+?)\s+saved to\s+/);
          let extractedSummary = match?.[1] ?? toolContent;
          // Ensure summary ends with a period
          if (!extractedSummary.endsWith(".")) {
            extractedSummary += ".";
          }
          return {
            messages: [new AIMessage(extractedSummary)],
          };
        }
      }

      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) throw new Error("Obsidian tool-bound model must return an AI message.");

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      console.log("Obsidian node response:", responseText);
      console.log("Tool calls:", toolCalls.map((call) => `${call.name}: ${JSON.stringify(call.args)}`).join(", "));

      let finalMessage: AIMessage = response;
      if (!hasToolCalls && responseText.length === 0) {
        const hasToolResults = state.messages.some(m => m instanceof ToolMessage);
        if (hasToolResults) {
          // Model returned empty after tool execution — re-invoke without tools to force narration
          const narrationResponse = await model.invoke(promptMessages);
          finalMessage = narrationResponse instanceof AIMessage ? narrationResponse : new AIMessage("Completed the Obsidian task.");
        } else {
          finalMessage = new AIMessage("Completed the Obsidian task.");
        }
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
