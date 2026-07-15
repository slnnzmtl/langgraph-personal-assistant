import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { AgentStateUpdate } from "../../state.js";
import type { IFileSender } from "../../telegram/file-sender.js";
import { createSubAgent } from "../create-sub-agent.js";
import { createObsidianNode, createObsidianSkillScopedTools } from "./index.js";

export const OBSIDIAN_MAX_STEPS = 8;

export const createObsidianSubgraphWrapper = (
  llmConnector: { getModel(): BaseChatModel },
  vaultRoot: string,
  fileSender?: IFileSender,
) =>
  createSubAgent({
    name: "Obsidian",
    maxSteps: OBSIDIAN_MAX_STEPS,
    deps: { llmConnector, vaultRoot, fileSender },
    createTools: (deps) => createObsidianSkillScopedTools(deps.vaultRoot, deps.fileSender),
    createLlmNode: (deps, tools) => createObsidianNode(deps.llmConnector, deps.vaultRoot, tools),
    mapResult: (result, { maxSteps }): AgentStateUpdate => {
      if (result.stepCount >= maxSteps) {
        return {
          messages: [new AIMessage(`Unable to edit the local markdown vault: exceeded the maximum of ${maxSteps} Obsidian tool steps.`)],
        };
      }

      const lastMessage = result.messages[result.messages.length - 1];
      return {
        messages: [lastMessage as AIMessage],
      };
    },
  });
