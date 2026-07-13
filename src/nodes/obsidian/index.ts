import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Annotation } from "@langchain/langgraph";
import { mkdir } from "node:fs/promises";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import {
  loadObsidianSystemPrompt,
} from "../../prompts/load-system-prompt.js";
import { extractMessageTextContent } from "../message-history.js";
import { buildDirectoryTree } from "../../utils/file-system.js";
import {
  createObsidianTools,
} from "./tools.js";
import { reduceAgentMessages } from "../../state.js";
import {
  handleWriteMarkdownResult,
  normalizeSearchResponseText,
} from "./response-handlers.js";

const SEARCH_POST_PROCESS_INSTRUCTION = "Post-process the markdown search results into the shortest useful answer. Return at most 3 relevant paths, prefer the most specific matches, and do not repeat the entire raw result list.";

export const ObsidianStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
});

export type ObsidianState = typeof ObsidianStateAnnotation.State;
export type ObsidianStateUpdate = typeof ObsidianStateAnnotation.Update;

/**
 * Build the Obsidian system prompt with vault directory context.
 * This is a high-value computation that reflects the current vault state.
 */
export const buildObsidianSystemPrompt = async (vaultRoot: string): Promise<string> => {
  const vaultDirectoryTree = await buildDirectoryTree(vaultRoot);
  return `${loadObsidianSystemPrompt()}\n\nVault directory tree (folders only):\n${vaultDirectoryTree}`;
};

export const createObsidianNode = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
  prebuiltTools?: ReturnType<typeof createObsidianTools>,
) => {
  const model = llmConnector.getModel();

  if (typeof model.bindTools !== "function") throw new Error("Obsidian tool-bound model must support tool calling.");
  const tools = prebuiltTools ?? createObsidianTools(vaultRoot);
  const modelWithTools = model.bindTools(tools);

  return async (state: ObsidianState): Promise<ObsidianStateUpdate> => {
    try {
      await mkdir(vaultRoot, { recursive: true });

      const systemPrompt = await buildObsidianSystemPrompt(vaultRoot);
      const promptMessages = mergeMessageRuns([new SystemMessage(systemPrompt), ...state.messages]);
      
      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      // Handle early-exit conditions for specific tool results
      const lastMessage = state.messages[state.messages.length - 1];

      // Write result: extract summary and return immediately
      if (lastMessage instanceof ToolMessage && lastMessage.name === "write_markdown_file") {
        const toolContent = typeof lastMessage.content === "string" ? lastMessage.content : String(lastMessage.content);
        if (toolContent.startsWith("Success:")) {
          const { summary } = handleWriteMarkdownResult(toolContent);
          return { messages: [new AIMessage(summary)] };
        }
      }

      // Search result: post-process and compress for concise answer
      if (lastMessage instanceof ToolMessage && lastMessage.name === "search_markdown_files") {
        const toolContent = typeof lastMessage.content === "string" ? lastMessage.content : String(lastMessage.content);
        const searchPromptMessages = [
          new SystemMessage(`${systemPrompt}

${SEARCH_POST_PROCESS_INSTRUCTION}`),
          ...state.messages,
        ];

        const searchResponse = await model.invoke(searchPromptMessages);
        const searchResponseText = searchResponse instanceof AIMessage
          ? extractMessageTextContent(searchResponse.content).trim()
          : "";

        const compactSearchText = normalizeSearchResponseText(searchResponseText, toolContent);
        return { messages: [new AIMessage(compactSearchText)] };
      }

      // Normal path: invoke the tool-bound model
      const response = await modelWithTools.invoke(promptMessages);
      if (!(response instanceof AIMessage)) throw new Error("Obsidian tool-bound model must return an AI message.");

      const responseText = extractMessageTextContent(response.content).trim();
      const toolCalls = response.tool_calls ?? [];
      const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

      console.log("Obsidian node response:", responseText);
      console.log("Tool calls:", toolCalls.map((call) => `${call.name}: ${JSON.stringify(call.args)}`).join(", "));

      // Fallback: if model returned empty after tools, re-invoke without tools to force narration
      let finalMessage: AIMessage = response;
      if (!hasToolCalls && responseText.length === 0) {
        const hasToolResults = state.messages.some(m => m instanceof ToolMessage);
        if (hasToolResults) {
          const narrationResponse = await model.invoke(promptMessages);
          finalMessage = narrationResponse instanceof AIMessage ? narrationResponse : new AIMessage("Completed the Obsidian task.");
        } else {
          finalMessage = new AIMessage("Completed the Obsidian task.");
        }
      }

      return { messages: [finalMessage] };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
      };
    }
  };
};
