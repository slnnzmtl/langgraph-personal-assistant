import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
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
// import {
//   normalizeSearchResponseText,
// } from "./response-handlers.js";

// const SEARCH_POST_PROCESS_INSTRUCTION = "Post-process the markdown search results into the shortest useful answer. Return at most 3 relevant paths, prefer the most specific matches, and do not repeat the entire raw result list.";

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

// const getMessageText = (message: BaseMessage): string =>
  // typeof message.content === "string" ? message.content : String(message.content);

// const isToolResult = (message: BaseMessage | undefined, toolName: string): message is ToolMessage =>
//   message instanceof ToolMessage && message.name === toolName;

// const postProcessSearchResult = async (
//   model: BaseChatModel,
//   systemPrompt: string,
//   messages: BaseMessage[],
//   searchResult: ToolMessage,
// ): Promise<AIMessage> => {
//   const searchPromptMessages = [
//     new SystemMessage(`${systemPrompt}\n\n${SEARCH_POST_PROCESS_INSTRUCTION}`),
//     ...messages,
//   ];
//   const searchResponse = await model.invoke(searchPromptMessages);
//   const searchResponseText = searchResponse instanceof AIMessage
//     ? extractMessageTextContent(searchResponse.content).trim()
//     : "";
//   return new AIMessage(normalizeSearchResponseText(searchResponseText, getMessageText(searchResult)));
// };

/**
 * Run the tool-bound model. When it returns neither tool calls nor text,
 * fall back to a plain narration so the node always emits a non-empty AI message.
 */
const invokeToolBoundModel = async (
  model: BaseChatModel,
  modelWithTools: Runnable,
  promptMessages: BaseMessage[],
  messages: BaseMessage[],
): Promise<AIMessage> => {
  const response = await modelWithTools.invoke(promptMessages);
  if (!(response instanceof AIMessage)) throw new Error("Obsidian tool-bound model must return an AI message.");

  const responseText = extractMessageTextContent(response.content).trim();
  const toolCalls = response.tool_calls ?? [];

  console.log("Obsidian node response:", responseText);
  console.log("Tool calls:", toolCalls.map((call) => `${call.name}: ${JSON.stringify(call.args)}`).join(", "));

  if (toolCalls.length > 0 || responseText.length > 0) return response;

  const hasToolResults = messages.some((message) => message instanceof ToolMessage);
  if (!hasToolResults) return new AIMessage("Completed the Obsidian task.");

  const narration = await model.invoke(promptMessages);
  return narration instanceof AIMessage ? narration : new AIMessage("Completed the Obsidian task.");
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

      // const lastMessage = state.messages[state.messages.length - 1];

      // if (isToolResult(lastMessage, "search_markdown_files")) {
      //   return { messages: [await postProcessSearchResult(model, systemPrompt, state.messages, lastMessage)] };
      // }

      const finalMessage = await invokeToolBoundModel(model, modelWithTools, promptMessages, state.messages);
      return { messages: [finalMessage] };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
      };
    }
  };
};
