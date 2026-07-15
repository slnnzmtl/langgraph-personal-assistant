import { AIMessage, SystemMessage, ToolMessage, mergeMessageRuns } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Runnable } from "@langchain/core/runnables";
import { mkdir } from "node:fs/promises";
import { logSystemPromptInvocation } from "../../../logging/system-prompt-logger.js";
import { resolveRuntimeAgentSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentDefinition } from "../../types.js";
import { extractMessageTextContent } from "../../../nodes/message-history.js";
import { hasPendingToolCalls } from "../../../tools/routing.js";
import { buildDirectoryTree } from "../../../utils/file-system.js";
import {
  isSkillScopedToolContext,
  resolveTurnTools,
  type SubAgentToolSource,
} from "../../execution/create-sub-agent.js";
import type { SubAgentState, SubAgentStateUpdate } from "../../execution/sub-agent-state.js";

export const buildObsidianSystemPrompt = async (
  vaultRoot: string,
  definition: RuntimeAgentDefinition,
): Promise<string> => {
  const vaultDirectoryTree = await buildDirectoryTree(vaultRoot);
  return `${resolveRuntimeAgentSystemPrompt(definition)}\n\nVault directory tree (folders only):\n${vaultDirectoryTree}`;
};

const invokeToolBoundModel = async (
  model: BaseChatModel,
  modelWithTools: Runnable,
  promptMessages: any[],
  messages: any[],
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
  definition: RuntimeAgentDefinition,
  prebuiltTools?: SubAgentToolSource,
) => {
  const model = llmConnector.getModel();

  if (typeof model.bindTools !== "function") throw new Error("Obsidian tool-bound model must support tool calling.");
  const bindTools = model.bindTools.bind(model);

  return async (state: SubAgentState): Promise<SubAgentStateUpdate> => {
    try {
      if (hasPendingToolCalls(state.messages)) {
        return { stepCount: state.stepCount };
      }

      const lastMessage = state.messages[state.messages.length - 1];
      const isLoopContinuation = lastMessage instanceof ToolMessage;
      const stepCount = isLoopContinuation ? state.stepCount + 1 : 1;

      await mkdir(vaultRoot, { recursive: true });

      const systemPrompt = await buildObsidianSystemPrompt(vaultRoot, definition);
      const promptMessages = mergeMessageRuns([new SystemMessage(systemPrompt), ...state.messages]);
      await logSystemPromptInvocation("obsidian-system-prompt", promptMessages);

      const toolsForTurn = prebuiltTools
        ? (isSkillScopedToolContext(prebuiltTools)
          ? resolveTurnTools(prebuiltTools, state.messages)
          : prebuiltTools)
        : [];
      const modelWithTools = bindTools(toolsForTurn);

      const finalMessage = await invokeToolBoundModel(model, modelWithTools, promptMessages, state.messages);
      return { messages: [finalMessage], stepCount };
    } catch (error) {
      return {
        messages: [new AIMessage(`Unable to edit the local markdown vault: ${error instanceof Error ? error.message : "Unknown error."}`)],
      };
    }
  };
};
