import { AIMessage } from "@langchain/core/messages";

import {
  isRuntimeAgentHandoffComplete,
  type RuntimeAgentHandoff,
} from "../execution/runtime-agent-handoff.js";
import type { AgentState, AgentStateUpdate, ExecutionQueue } from "../state.js";
import { POST_HANDOFF_FINISH_ROUTE } from "../state.js";
import { CONFIGURATION_AGENT_ID, RUNTIME_AGENT_CONTEXT_KEY } from "../types/agent.js";
import {
  normalizeDelegationPrompt,
  normalizeSupervisorReply,
  type ExecutionStep,
  type RoutingDecision,
} from "./routing-schema.js";

const AFFIRMATIVE_FOLLOW_UP = /^(yes|yeah|yep|sure|ok|okay|please|do it|go ahead)\.?$/i;

export const DEFAULT_MAX_ERROR_RETRIES = 2;

export const isAffirmativeFollowUp = (text: string): boolean =>
  AFFIRMATIVE_FOLLOW_UP.test(text.trim());

export const isExplicitRetryRequest = (text: string): boolean =>
  /\b(retry|try again|run again|do it again)\b/i.test(text.trim());

export const buildPostHandoffReplanHint = (
  state: AgentState,
  latestUserText: string,
  maxErrorRetries: number = DEFAULT_MAX_ERROR_RETRIES,
): string | null => {
  const handoff = state.lastHandoff;

  if (
    handoff === null
    || handoff === undefined
    || handoff.status === "empty"
    || state.executionQueue.length > 0
  ) {
    return null;
  }

  const lines = [
    "<post_handoff_replan_context>",
    `The runtime agent "${handoff.agentId}" just completed with status "${handoff.status}".`,
    `Latest user message: ${latestUserText || "(none)"}`,
    "Default to FINISH with a synthesized user-facing reply from visible thread history.",
    "Do not re-route to the same agent unless the user explicitly asks to retry.",
  ];

  if (handoff.status === "error") {
    const remaining = Math.max(0, maxErrorRetries - state.retryCount);
    if (remaining > 0) {
      lines.push(
        "This attempt failed with an error.",
        `You may retry "${handoff.agentId}" with corrected parameters based on the error.`,
        `${remaining} automatic ${remaining === 1 ? "retry" : "retries"} left.`,
      );
    } else {
      lines.push(
        "Retry budget exhausted.",
        "FINISH and explain the failure to the user instead of retrying again.",
      );
    }
  }

  if (isAffirmativeFollowUp(latestUserText)) {
    lines.push(
      "The latest user message looks like an affirmative follow-up to a prior assistant offer or question.",
      "FINISH and summarize the outcome from visible history; do not enqueue the same work again.",
    );
  }

  lines.push(
    "If specialists already answered the original request, do not re-emit the same queue.",
    "</post_handoff_replan_context>",
  );

  return lines.join("\n");
};

export const isBlockedRepeatRoute = (
  lastHandoff: RuntimeAgentHandoff | null | undefined,
  response: RoutingDecision,
  latestUserText: string,
): boolean => {
  if (response.next === "FINISH") {
    return false;
  }

  if (!isRuntimeAgentHandoffComplete(lastHandoff)) {
    return false;
  }

  if (isExplicitRetryRequest(latestUserText)) {
    return false;
  }

  const head = resolveEffectiveExecutionPlan(response)[0];
  if (!head) {
    return false;
  }

  return head.agentId === lastHandoff.agentId;
};

export const isAutoRetryableErrorRoute = (
  lastHandoff: RuntimeAgentHandoff | null | undefined,
  response: RoutingDecision,
  retryCount: number,
  maxErrorRetries: number = DEFAULT_MAX_ERROR_RETRIES,
): boolean => {
  if (response.next === "FINISH") {
    return false;
  }

  if (!lastHandoff || lastHandoff.status !== "error") {
    return false;
  }

  if (retryCount >= maxErrorRetries) {
    return false;
  }

  const head = resolveEffectiveExecutionPlan(response)[0];
  if (!head) {
    return false;
  }

  return head.agentId === lastHandoff.agentId;
};

export const enqueueAndStart = (steps: readonly ExecutionStep[]): AgentStateUpdate => {
  const [head, ...tail] = steps;

  if (head === undefined) {
    throw new Error("enqueueAndStart requires at least one execution step");
  }

  return {
    next: head.agentId,
    delegationPrompt: head.prompt,
    executionQueue: [...tail],
    lastHandoff: null,
    routingFailureContext: null,
    retryCount: 0,
    context: {
      [RUNTIME_AGENT_CONTEXT_KEY]: head.agentId,
    },
  };
};

export const routeToRuntimeAgent = (agentId: string, prompt: string): AgentStateUpdate =>
  enqueueAndStart([{ agentId, prompt }]);

export const clearExecutionQueue = (): Pick<AgentStateUpdate, "executionQueue" | "delegationPrompt"> => ({
  executionQueue: [],
  delegationPrompt: null,
});

export const tryCronRouteUpdate = (
  cronRoute: string | undefined,
  superviseCronRoute: string | undefined,
  wiredAgentIds?: ReadonlySet<string>,
  delegationPrompt?: string,
): AgentStateUpdate | null => {
  if (!cronRoute || cronRoute === superviseCronRoute) {
    return null;
  }

  if (wiredAgentIds && !wiredAgentIds.has(cronRoute)) {
    return null;
  }

  const prompt = normalizeDelegationPrompt(delegationPrompt) ?? "Execute the scheduled job.";

  return enqueueAndStart([{ agentId: cronRoute, prompt }]);
};

export const needsEmptySubAgentSummary = (state: AgentState): boolean =>
  state.lastHandoff?.status === "empty";

export const resolveEffectiveExecutionPlan = (
  response: RoutingDecision,
): ExecutionQueue => {
  if (response.queue && response.queue.length > 0) {
    return response.queue.map((step) => ({
      agentId: step.agentId,
      prompt: normalizeDelegationPrompt(step.prompt) ?? "",
    }));
  }

  if (response.next !== "FINISH") {
    const prompt = normalizeDelegationPrompt(response.prompt) ?? "";

    return [{ agentId: response.next, prompt }];
  }

  return [];
};

export const detectCompletionState = (
  state: AgentState,
  maxErrorRetries: number = DEFAULT_MAX_ERROR_RETRIES,
): AgentStateUpdate | null => {
  if (needsEmptySubAgentSummary(state)) {
    return null;
  }

  if (!isRuntimeAgentHandoffComplete(state.lastHandoff)) {
    return null;
  }

  if (state.executionQueue.length > 0) {
    return enqueueAndStart(state.executionQueue);
  }

  if (
    state.lastHandoff?.status === "error"
    && state.retryCount < maxErrorRetries
  ) {
    return null;
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const specialistJustFinished = lastMessage instanceof AIMessage;
  const configurationHandoff = state.lastHandoff?.agentId === CONFIGURATION_AGENT_ID;

  if (!specialistJustFinished || !configurationHandoff) {
    return null;
  }

  return {
    next: POST_HANDOFF_FINISH_ROUTE,
    routingFailureContext: null,
    lastHandoff: state.lastHandoff,
  };
};

export const resolveRoutingDecision = async (
  response: RoutingDecision,
  enabledAgentIds: Set<string>,
  onFailure: (failureContext: string) => Promise<AgentStateUpdate>,
  options?: {
    lastHandoff?: RuntimeAgentHandoff | null;
    latestUserText?: string;
    retryCount?: number;
    maxErrorRetries?: number;
  },
): Promise<AgentStateUpdate> => {
  const retryCount = options?.retryCount ?? 0;
  const maxErrorRetries = options?.maxErrorRetries ?? DEFAULT_MAX_ERROR_RETRIES;

  if (response.next === "FINISH") {
    const reply = normalizeSupervisorReply(response.reply);

    if (reply === undefined) {
      return onFailure("The routing model returned FINISH without a reply.");
    }

    return {
      next: response.next,
      lastHandoff: null,
      routingFailureContext: null,
      executionQueue: [],
      delegationPrompt: null,
      retryCount: 0,
      messages: [new AIMessage(reply)],
    };
  }

  const effectivePlan = resolveEffectiveExecutionPlan(response);

  if (
    options?.lastHandoff
    && isAutoRetryableErrorRoute(options.lastHandoff, response, retryCount, maxErrorRetries)
  ) {
    return {
      ...enqueueAndStart(effectivePlan),
      retryCount: retryCount + 1,
    };
  }

  if (
    options?.lastHandoff
    && options.latestUserText !== undefined
    && isBlockedRepeatRoute(options.lastHandoff, response, options.latestUserText)
  ) {
    const remaining = effectivePlan.slice(1);

    if (remaining.length > 0) {
      return enqueueAndStart(remaining);
    }

    return {
      next: POST_HANDOFF_FINISH_ROUTE,
      lastHandoff: options.lastHandoff,
      routingFailureContext: null,
      executionQueue: [],
      delegationPrompt: null,
      retryCount: 0,
    };
  }

  if (effectivePlan.length === 0) {
    return onFailure(`Missing delegation prompt for runtime agent: ${response.next}`);
  }

  for (const step of effectivePlan) {
    if (!enabledAgentIds.has(step.agentId)) {
      return onFailure(`Unknown or disabled runtime agent route: ${step.agentId}`);
    }

    if (step.prompt.length === 0) {
      return onFailure(`Missing delegation prompt for runtime agent: ${step.agentId}`);
    }
  }

  if (response.reply !== undefined) {
    console.warn(
      `Supervisor routing ignored a reply while delegating to ${effectivePlan.map((step) => step.agentId).join(" → ")}.`,
    );
  }

  return enqueueAndStart(effectivePlan);
};

export const formatExecutionPlanLog = (
  steps: ReadonlyArray<{ agentId: string; prompt?: string | null | undefined }>,
): string => steps.map((step) => `${step.agentId}: ${step.prompt ?? ""}`).join(" → ");
