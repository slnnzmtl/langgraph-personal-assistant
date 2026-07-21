import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../../connectors/llm-connector.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { FINISH_ROUTE } from "../state.js";
import { stripToolsForSupervisor } from "./message-history.js";
import { buildFailureReplyText } from "./reply-helpers.js";

export type FailureReplyNodeOptions = {
  loadSupervisorPrompt: () => string;
};

export const createFailureReplyNode = (
  llmConnector: ILLMConnector,
  options: FailureReplyNodeOptions,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const supervisorPromptText = options.loadSupervisorPrompt();
    const failureContext = state.routingFailureContext?.trim()
      ?? "Supervisor routing failed without additional context.";
    const promptMessages = stripToolsForSupervisor([
      new SystemMessage(supervisorPromptText),
      ...state.messages,
    ]);

    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      messages: [
        new AIMessage(
          await buildFailureReplyText(
            llmConnector,
            promptMessages,
            supervisorPromptText,
            failureContext,
            config,
          ),
        ),
      ],
    };
  };
