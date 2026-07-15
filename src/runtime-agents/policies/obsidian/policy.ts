import { AIMessage } from "@langchain/core/messages";

import { OBSIDIAN_MAX_STEPS } from "../../constants.js";
import { createSubAgent } from "../../execution/create-sub-agent.js";
import type { RuntimeAgentExecutionContext } from "../../execution-context.js";
import type { AgentStateUpdate } from "../../../state.js";
import { withResolvedSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentPolicy } from "../types.js";
import { createObsidianNode } from "./node.js";
import { createObsidianSkillScopedTools } from "./tools.js";

export const obsidianPolicy: RuntimeAgentPolicy = {
  executor: "obsidian",
  createHandler: (context, definition) => {
    const resolvedDefinition = withResolvedSystemPrompt(definition);
    const maxSteps = resolvedDefinition.maxSteps ?? OBSIDIAN_MAX_STEPS;

    return createSubAgent({
      name: "Obsidian",
      maxSteps,
      deps: {
        llmConnector: context.obsidianLlmConnector,
        vaultRoot: context.bundleDeps.obsidianVaultPath,
        fileSender: context.bundleDeps.fileSender,
        definition: resolvedDefinition,
      },
      createTools: (deps) => createObsidianSkillScopedTools(deps.vaultRoot, deps.fileSender),
      createLlmNode: (deps, tools) => createObsidianNode(deps.llmConnector, deps.vaultRoot, deps.definition, tools),
      mapResult: (result): AgentStateUpdate => {
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
  },
};
