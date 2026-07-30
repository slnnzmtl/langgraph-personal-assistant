import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../ports/llm-connector.js";
import { noopPromptLogging, type PromptLoggingHook } from "../ports/prompt-logging.js";
import { stripToolsForSupervisor } from "./message-history.js";
import type { RuntimeAgentRepository } from "../agents/repository.js";
import {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  type RoutingDecision,
} from "./routing-schema.js";
import type { AgentState, AgentStateUpdate } from "../state.js";
import { EMPTY_REPLY_ROUTE, FAILURE_REPLY_ROUTE } from "../state.js";
import {
  buildPostHandoffReplanHint,
  DEFAULT_MAX_ERROR_RETRIES,
  detectCompletionState,
  formatExecutionPlanLog,
  needsEmptySubAgentSummary,
  resolveRoutingDecision,
  tryCronRouteUpdate,
} from "./helpers.js";
import { findLatestSubstantiveHumanMessageText } from "./reply-helpers.js";
import type { ContextCacheKit } from "../llm/context-cache-types.js";
import { buildCachedRuntimePromptMessages } from "./cache-prompt-messages.js";

export type CronTriggerResolver = {
  resolveCronTriggerRoute: (message: BaseMessage | undefined) => string | undefined;
  superviseCronRoute: string;
};

export type SupervisorNodeOptions = {
  runtimeAgentRepository?: RuntimeAgentRepository;
  wiredAgentIds: ReadonlySet<string>;
  /** Static supervisor instructions (no datetime / replan hints). */
  loadSupervisorPrompt: () => string;
  /** Per-turn metadata such as CURRENT DATETIME. */
  buildSupervisorDynamicContext?: () => string;
  contextCache?: ContextCacheKit;
  promptLogging?: PromptLoggingHook;
  cronTriggerResolver?: CronTriggerResolver;
  maxErrorRetries?: number;
};

const composeSupervisorDynamicContext = (
  dynamicContext: string,
  replanHint: string | undefined,
): string =>
  [dynamicContext.trim(), replanHint?.trim()]
    .filter((section): section is string => Boolean(section && section.length > 0))
    .join("\n");

const buildUncachedSupervisorSystemMessage = (
  staticPrompt: string,
  dynamicBlock: string,
): SystemMessage =>
  new SystemMessage(
    dynamicBlock.length > 0 ? `${staticPrompt}\n\n${dynamicBlock}` : staticPrompt,
  );

export const createSupervisorNode = (
  llmConnector: ILLMConnector,
  options: SupervisorNodeOptions,
) =>
  async (state: AgentState, config?: RunnableConfig): Promise<AgentStateUpdate> => {
    const promptLogging = options.promptLogging ?? noopPromptLogging;
    const maxErrorRetries = options.maxErrorRetries ?? DEFAULT_MAX_ERROR_RETRIES;
    const staticSupervisorPrompt = options.loadSupervisorPrompt().trim();
    const dynamicContext = options.buildSupervisorDynamicContext?.() ?? "";
    const latestUserText = findLatestSubstantiveHumanMessageText(state.messages);
    const lastMessage = state.messages[state.messages.length - 1];
    const cronRoute = options.cronTriggerResolver?.resolveCronTriggerRoute(lastMessage);

    const cronRouteUpdate = tryCronRouteUpdate(
      cronRoute,
      options.cronTriggerResolver?.superviseCronRoute,
      options.wiredAgentIds,
      latestUserText,
    );

    if (cronRouteUpdate) {
      return cronRouteUpdate;
    }

    if (needsEmptySubAgentSummary(state)) {
      return { next: EMPTY_REPLY_ROUTE, executionQueue: [], delegationPrompt: null };
    }

    const completionUpdate = detectCompletionState(state, maxErrorRetries);

    if (completionUpdate) {
      return completionUpdate;
    }

    const replanHint = buildPostHandoffReplanHint(state, latestUserText, maxErrorRetries);
    const dynamicBlock = composeSupervisorDynamicContext(dynamicContext, replanHint ?? undefined);

    let routingModel: BaseChatModel | undefined;
    let promptMessages: BaseMessage[];
    let loggedPromptMessages: BaseMessage[];

    if (options.contextCache) {
      const handle = await options.contextCache.cacheManager.getOrCreate({
        modelName: options.contextCache.supervisorModelName,
        staticSystemInstruction: staticSupervisorPrompt,
        tools: [],
        displayName: "supervisor",
      });

      if (handle) {
        routingModel = options.contextCache.createCachedModel(
          options.contextCache.apiKey,
          options.contextCache.supervisorModelName,
          handle,
        );
        const rawPromptMessages = buildCachedRuntimePromptMessages(dynamicBlock, state.messages);
        promptMessages = stripToolsForSupervisor(rawPromptMessages);
        loggedPromptMessages = rawPromptMessages;
      } else {
        const supervisorPrompt = buildUncachedSupervisorSystemMessage(
          staticSupervisorPrompt,
          dynamicBlock,
        );
        const rawPromptMessages = [supervisorPrompt, ...state.messages];
        promptMessages = stripToolsForSupervisor(rawPromptMessages);
        loggedPromptMessages = rawPromptMessages;
      }
    } else {
      const supervisorPrompt = buildUncachedSupervisorSystemMessage(
        staticSupervisorPrompt,
        dynamicBlock,
      );
      const rawPromptMessages = [supervisorPrompt, ...state.messages];
      promptMessages = stripToolsForSupervisor(rawPromptMessages);
      loggedPromptMessages = rawPromptMessages;
    }

    await promptLogging("supervisor-system-prompt", loggedPromptMessages);

    const runtimeAgents = options.runtimeAgentRepository
      ? await options.runtimeAgentRepository.loadAgents()
      : [];
    const routableAgents = filterRoutableRuntimeAgents(runtimeAgents, options.wiredAgentIds);
    const enabledAgentIds = new Set(routableAgents.map((agent) => agent.id));
    const routingSchema = buildSupervisorRoutingSchema(runtimeAgents, options.wiredAgentIds);
    const routingChain = llmConnector.bindRoutingTools<RoutingDecision>(
      routingSchema,
      routingModel ? { model: routingModel } : undefined,
    );

    const buildFailureUpdate = async (failureContext: string): Promise<AgentStateUpdate> => ({
      next: FAILURE_REPLY_ROUTE,
      routingFailureContext: failureContext,
      lastHandoff: null,
      executionQueue: [],
      delegationPrompt: null,
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
    } else if (response.queue && response.queue.length > 0) {
      console.log("Supervisor routing decision:", formatExecutionPlanLog(response.queue));
    } else {
      console.log("Supervisor routing decision:", response.next, response.prompt);
    }

    return resolveRoutingDecision(
      response,
      enabledAgentIds,
      buildFailureUpdate,
      {
        lastHandoff: state.lastHandoff,
        latestUserText,
        retryCount: state.retryCount,
        maxErrorRetries,
      },
    );
  };
