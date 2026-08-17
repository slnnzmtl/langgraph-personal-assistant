import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import {
  formatRecentToolResultsForHandoff,
  type RuntimeAgentHandoff,
} from "../execution/runtime-agent-handoff.js";
import type { ILLMConnector } from "../ports/llm-connector.js";
import { extractMessageTextContent } from "../message-content.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { FINISH_ROUTE } from "../state.js";
import { stripToolsForSupervisor } from "./message-history.js";
import { clearDelegationContext } from "./helpers.js";
import {
  buildFailureReplyText,
  findLatestAiReplySinceLastHuman,
  findLatestHumanMessageText,
  isRoutingJson,
} from "./reply-helpers.js";
import { defaultReplyUxConfig, DEFAULT_GENERIC_COMPLETION_FALLBACKS, type ReplyUxConfig } from "./reply-ux.js";

const resolveHandoffEvidence = (
  handoff: RuntimeAgentHandoff | null | undefined,
  messages?: BaseMessage[],
): string =>
  handoff?.resultSummary?.trim()
  || handoff?.toolContext?.trim()
  || (messages ? formatRecentToolResultsForHandoff(messages) : "");

export const createEmptyReplyNode = (
  llmConnector: ILLMConnector,
  replyUx: ReplyUxConfig = defaultReplyUxConfig,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const handoff = state.lastHandoff;
    const agentName = handoff?.agentName ?? "runtime agent";
    const toolContext = resolveHandoffEvidence(handoff);
    const latestUserRequest = findLatestHumanMessageText(state.messages);
    const replyContext = { agentName, toolContext, latestUserRequest };
    const safeFallback = replyUx.buildEmptyReplySafeFallback(replyContext);
    const finalizerResponse = await llmConnector.getModel().invoke([
      new SystemMessage(replyUx.buildEmptyReplySystemPrompt(replyContext)),
      new HumanMessage(latestUserRequest || "Provide the status based on the tool result."),
    ], config);
    const finalizerText = extractMessageTextContent(finalizerResponse.content).trim();

    const replyText = finalizerText.length > 0 && !isRoutingJson(finalizerText)
      ? finalizerText
      : safeFallback;

    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      messages: [new AIMessage(replyText)],
      context: clearDelegationContext(),
    };
  };

export type FailureReplyNodeOptions = {
  loadSupervisorPrompt: () => string;
  replyUx?: ReplyUxConfig;
};

export const createFailureReplyNode = (
  llmConnector: ILLMConnector,
  options: FailureReplyNodeOptions,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const replyUx = options.replyUx ?? defaultReplyUxConfig;
    const supervisorPromptText = options.loadSupervisorPrompt();
    const failureContext = state.routingFailureContext?.trim()
      ?? "Supervisor routing failed without additional context.";
    console.warn("Supervisor failure_reply context:", failureContext);
    const promptMessages = stripToolsForSupervisor([
      new SystemMessage(supervisorPromptText),
      ...state.messages,
    ]);

    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      context: clearDelegationContext(),
      messages: [
        new AIMessage(
          await buildFailureReplyText(
            llmConnector,
            promptMessages,
            supervisorPromptText,
            failureContext,
            replyUx,
            config,
          ),
        ),
      ],
    };
  };

export const createPostHandoffFinishNode = (
  llmConnector: ILLMConnector,
  replyUx: ReplyUxConfig = defaultReplyUxConfig,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const handoff = state.lastHandoff;
    const agentName = handoff?.agentName ?? "runtime agent";
    const latestUserRequest = findLatestHumanMessageText(state.messages);
    const existingReply = findLatestAiReplySinceLastHuman(state.messages);
    const genericFallbacks = replyUx.genericCompletionFallbacks ?? DEFAULT_GENERIC_COMPLETION_FALLBACKS;

    if (existingReply.length > 0 && !genericFallbacks.has(existingReply)) {
      return {
        next: FINISH_ROUTE,
        lastHandoff: null,
        routingFailureContext: null,
        context: clearDelegationContext(),
      };
    }

    const toolContext = resolveHandoffEvidence(handoff, state.messages);
    const replyContext = { agentName, toolContext, latestUserRequest };
    const safeFallback = replyUx.buildPostHandoffFinishSafeFallback(replyContext);
    const finalizerResponse = await llmConnector.getModel().invoke([
      new SystemMessage(replyUx.buildPostHandoffFinishSystemPrompt(replyContext)),
      new HumanMessage(latestUserRequest || "Summarize the completed work for the user."),
    ], config);
    const finalizerText = extractMessageTextContent(finalizerResponse.content).trim();

    const replyText = finalizerText.length > 0 && !isRoutingJson(finalizerText)
      ? finalizerText
      : safeFallback;

    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      messages: [new AIMessage(replyText)],
      context: clearDelegationContext(),
    };
  };
