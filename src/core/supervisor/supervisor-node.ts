import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { ILLMConnector } from "../../connectors/llm-connector.js";
import { getEmptySubAgentHandoff } from "../execution/runtime-agent-handoff.js";
import { logSystemPromptInvocation } from "../../logging/system-prompt-logger.js";
import { extractMessageTextContent } from "../../utils/message-content.js";
import { stripToolsForSupervisor } from "./message-history.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  type RoutingDecision,
} from "./routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import {
  createResolveAgentId,
  detectCompletionState,
  needsEmptySubAgentSummary,
  resolveRoutingDecision,
  tryCronRouteUpdate,
} from "./helpers.js";

export type CronTriggerResolver = {
  resolveCronTriggerRoute: (message: BaseMessage | undefined) => string | undefined;
  superviseCronRoute: string;
};

export type SupervisorNodeOptions = {
  runtimeAgentRepository?: RuntimeAgentRepository;
  wiredAgentIds: ReadonlySet<string>;
  loadSupervisorPrompt: () => string;
  cronTriggerResolver?: CronTriggerResolver;
  resolveAgentId?: (routeOrId: string) => string;
};

const buildPlainTextReply = async (
  llmConnector: ILLMConnector,
  promptMessages: BaseMessage[],
  supervisorPromptText: string,
  instruction: string,
  config?: RunnableConfig,
): Promise<string> => {
  const fallbackResponse = await llmConnector.getModel().invoke([
    new SystemMessage(`${supervisorPromptText}\n${instruction}`),
    ...promptMessages.slice(1),
  ], config);

  const fallbackText = extractMessageTextContent(fallbackResponse.content).trim();

  if (fallbackText.length > 0) {
    return fallbackText;
  }

  throw new Error("Supervisor final reply model returned an empty response.");
};

const buildFailureReply = async (
  llmConnector: ILLMConnector,
  promptMessages: BaseMessage[],
  supervisorPromptText: string,
  failureContext: string,
  config?: RunnableConfig,
): Promise<string> =>
  buildPlainTextReply(
    llmConnector,
    promptMessages,
    supervisorPromptText,
    `The normal supervisor routing failed. Produce the final user-facing reply in plain text. Explain the issue briefly and helpfully, and do not output JSON or call tools. Failure context: ${failureContext}`,
    config,
  );

const findLatestHumanMessageText = (messages: BaseMessage[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage || message?._getType() === "human") {
      return extractMessageTextContent(message.content).trim();
    }
  }

  return "";
};

const isRoutingJson = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && ("next" in parsed || "reply" in parsed);
  } catch {
    return false;
  }
};

const buildEmptySubAgentSummary = async (
  llmConnector: ILLMConnector,
  state: AgentState,
  config?: RunnableConfig,
): Promise<string> => {
  const handoff = getEmptySubAgentHandoff(state.messages[state.messages.length - 1]);
  const agentName = handoff?.agentName ?? "runtime agent";
  const toolContext = handoff?.toolContext?.trim() ?? "";
  const safeFallback = toolContext.length > 0
    ? `${agentName} did not produce a reliable summary. Its last tool result was:\n${toolContext}`
    : `${agentName} did not produce a user-facing reply, and no tool result was available to summarize.`;
  const latestUserRequest = findLatestHumanMessageText(state.messages);
  const finalizerResponse = await llmConnector.getModel().invoke([
    new SystemMessage([
      "You write a final user-facing status message for a specialized agent that stopped without replying.",
      "Return plain text only. Do not return JSON, routing instructions, tool calls, or a plan for future work.",
      "Treat the supplied tool result as authoritative and report only facts it supports.",
      "If it shows the requested state is already present, say it is already present; do not say you will perform the change.",
      "Do not claim a write occurred unless the tool result explicitly proves it.",
      `Specialized agent: ${agentName}`,
      toolContext.length > 0
        ? `Authoritative last tool result:\n${toolContext}`
        : "No tool result is available.",
    ].join("\n\n")),
    new HumanMessage(latestUserRequest || "Provide the status based on the tool result."),
  ], config);
  const finalizerText = extractMessageTextContent(finalizerResponse.content).trim();

  if (finalizerText.length > 0 && !isRoutingJson(finalizerText)) {
    return finalizerText;
  }

  return safeFallback;
};

export const createSupervisorNode = (
  llmConnector: ILLMConnector,
  options: SupervisorNodeOptions,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const resolveAgentId = createResolveAgentId(options.resolveAgentId);
    const supervisorPromptText = options.loadSupervisorPrompt();
    const supervisorPrompt = new SystemMessage(supervisorPromptText);
    const lastMessage = state.messages[state.messages.length - 1];
    const cronRoute = options.cronTriggerResolver?.resolveCronTriggerRoute(lastMessage);

    const cronRouteUpdate = tryCronRouteUpdate(
      cronRoute,
      options.cronTriggerResolver?.superviseCronRoute,
      resolveAgentId,
      options.wiredAgentIds,
    );

    if (cronRouteUpdate) {
      return cronRouteUpdate;
    }

    const rawPromptMessages = [
      supervisorPrompt,
      ...state.messages,
    ];
    const promptMessages = stripToolsForSupervisor(rawPromptMessages);

    if (needsEmptySubAgentSummary(state)) {
      return {
        next: "FINISH",
        messages: [
          new AIMessage(
            await buildEmptySubAgentSummary(
              llmConnector,
              state,
              config,
            ),
          ),
        ],
      };
    }

    const completionUpdate = detectCompletionState(state, promptMessages);

    if (completionUpdate) {
      return completionUpdate;
    }

    await logSystemPromptInvocation("supervisor-system-prompt", rawPromptMessages);

    const runtimeAgents = options.runtimeAgentRepository
      ? await options.runtimeAgentRepository.loadAgents()
      : [];
    const routableAgents = filterRoutableRuntimeAgents(runtimeAgents, options.wiredAgentIds);
    const enabledAgentIds = new Set(routableAgents.map((agent) => agent.id));
    const routingSchema = buildSupervisorRoutingSchema(runtimeAgents, options.wiredAgentIds);
    const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(routingSchema);

    const buildFailureUpdate = async (failureContext: string): Promise<AgentStateUpdate> => ({
      next: "FINISH",
      messages: [
        new AIMessage(
          await buildFailureReply(
            llmConnector,
            promptMessages,
            supervisorPromptText,
            failureContext,
            config,
          ),
        ),
      ],
    });

    let response: RoutingDecision;

    try {
      response = await routingChain.invoke(promptMessages, config);
    } catch (error) {
      console.warn("Supervisor routing structured output failed:", error);
      const failureMessage = error instanceof Error ? error.message : String(error);

      return buildFailureUpdate(`Structured routing failed: ${failureMessage}`);
    }

    if (response.next === "FINISH") {
      console.log("Supervisor routing decision:", response.next, response.reply);
    } else {
      console.log("Supervisor routing decision:", response.next);
    }

    return resolveRoutingDecision(
      response,
      enabledAgentIds,
      resolveAgentId,
      buildFailureUpdate,
    );
  };
