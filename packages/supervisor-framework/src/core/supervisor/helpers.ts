import { AIMessage } from "@langchain/core/messages";

import {
  isRuntimeAgentHandoffComplete,
  type RuntimeAgentHandoff,
} from "../execution/runtime-agent-handoff.js";
import type { AgentState, AgentStateUpdate, ExecutionQueue } from "../state.js";
import { FINISH_ROUTE, POST_HANDOFF_FINISH_ROUTE } from "../state.js";
import {
  DELEGATION_TASK_CONTEXT_KEY,
  MULTI_SPECIALIST_TURN_CONTEXT_KEY,
  PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY,
  RUNTIME_AGENT_CONTEXT_KEY,
  SYSTEM_AGENT_ID,
} from "../types/agent.js";
import {
  normalizeSupervisorReply,
  toExecutionStep,
  type ExecutionStep,
  type RoutingDecision,
} from "./routing-schema.js";

const AFFIRMATIVE_FOLLOW_UP = /^(yes|yeah|yep|sure|ok|okay|please|do it|go ahead)\.?$/i;

export const DEFAULT_MAX_ERROR_RETRIES = 2;

export const isAffirmativeFollowUp = (text: string): boolean =>
  AFFIRMATIVE_FOLLOW_UP.test(text.trim());

export const isExplicitRetryRequest = (text: string): boolean =>
  /\b(retry|try again|run again|do it again)\b/i.test(text.trim());

const planHeadMatchesHandoff = (
  handoff: RuntimeAgentHandoff,
  response: RoutingDecision,
): boolean => {
  const head = resolveEffectiveExecutionPlan(response)[0];
  return head !== undefined && head.agentId === handoff.agentId;
};

export const buildPostHandoffReplanHint = (
  state: AgentState,
  latestUserText: string,
  maxErrorRetries: number = DEFAULT_MAX_ERROR_RETRIES,
): string | null => {
  const handoff = state.lastHandoff;

  if (!isRuntimeAgentHandoffComplete(handoff) || state.executionQueue.length > 0) {
    return null;
  }

  const lines = [
    "<post_handoff_replan_context>",
    `The runtime agent "${handoff.agentId}" just completed with status "${handoff.status}".`,
    `Latest user message: ${latestUserText || "(none)"}`,
    "Treat Latest user message as the current intent signal; resolve short or ambiguous replies using the prior assistant turn. Do not resurrect unrelated earlier user requests.",
    "If the user's request covered multiple domains (e.g. plan AND expenses), route any remaining specialists before FINISH.",
    "When the original request is complete, FINISH and synthesize a user-facing reply from the specialist's output in visible thread history.",
    "Quote or summarize the specialist's actual findings—never reply with a generic greeting or filler.",
    "Do not re-route the same completed work unless the user explicitly asks to retry or accepts an offer of new work.",
    "Never invent extra specialist work beyond the latest user request (no carry-over, cleanup, or extra tasks unless asked).",
  ];

  if (handoff.resultSummary) {
    lines.push(`Specialist result summary: ${handoff.resultSummary}`);
  }

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
      "If the prior assistant offered NEW work, route to that specialist. The specialist sees the offer in thread history.",
      "If the prior turn only reported completion or asked for a summary ack, FINISH and summarize; do not repeat the same completed task.",
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

  // Allow offer acceptance / confirmation (e.g. "yes" after "Would you like to sync?").
  if (isAffirmativeFollowUp(latestUserText)) {
    return false;
  }

  return planHeadMatchesHandoff(lastHandoff, response);
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

  return planHeadMatchesHandoff(lastHandoff, response);
};

export type EnqueueAndStartOptions = {
  priorHandoff?: RuntimeAgentHandoff | null;
  continuingMultiSpecialistTurn?: boolean;
};

export const buildExecutionContext = (
  step: ExecutionStep,
  options: {
    priorHandoff?: RuntimeAgentHandoff | null;
    multiSpecialistTurn: boolean;
  },
): Record<string, unknown> => {
  const task = step.task ?? null;
  const priorSummary = options.priorHandoff?.resultSummary?.trim() || null;

  return {
    [RUNTIME_AGENT_CONTEXT_KEY]: step.agentId,
    [DELEGATION_TASK_CONTEXT_KEY]: task,
    [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: priorSummary,
    [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: options.multiSpecialistTurn ? true : null,
  };
};

export const clearDelegationContext = (): Record<string, unknown> => ({
  [RUNTIME_AGENT_CONTEXT_KEY]: null,
  [DELEGATION_TASK_CONTEXT_KEY]: null,
  [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: null,
  [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: null,
});

export const enqueueAndStart = (
  steps: readonly ExecutionStep[],
  options: EnqueueAndStartOptions = {},
): AgentStateUpdate => {
  const [head, ...tail] = steps;

  if (head === undefined) {
    throw new Error("enqueueAndStart requires at least one execution step");
  }

  const priorHandoff = options.priorHandoff ?? null;
  const multiSpecialistTurn =
    options.continuingMultiSpecialistTurn === true
    || steps.length > 1;

  return {
    next: head.agentId,
    executionQueue: [...tail],
    lastHandoff: null,
    routingFailureContext: null,
    retryCount: 0,
    context: buildExecutionContext(head, {
      priorHandoff,
      multiSpecialistTurn,
    }),
  };
};

export const tryCronRouteUpdate = (
  cronRoute: string | undefined,
  superviseCronRoute: string | undefined,
  wiredAgentIds?: ReadonlySet<string>,
): AgentStateUpdate | null => {
  if (!cronRoute || cronRoute === superviseCronRoute) {
    return null;
  }

  if (wiredAgentIds && !wiredAgentIds.has(cronRoute)) {
    return null;
  }

  return enqueueAndStart([{ agentId: cronRoute }]);
};

export const needsEmptySubAgentSummary = (state: AgentState): boolean =>
  state.lastHandoff?.status === "empty";

export const resolveEffectiveExecutionPlan = (
  response: RoutingDecision,
): ExecutionQueue => {
  if (response.queue && response.queue.length > 0) {
    return response.queue.map((step) => toExecutionStep(step));
  }

  if (response.next !== "FINISH") {
    return [toExecutionStep({ agentId: response.next })];
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
    return enqueueAndStart(state.executionQueue, {
      priorHandoff: state.lastHandoff,
      continuingMultiSpecialistTurn: true,
    });
  }

  if (
    state.lastHandoff?.status === "error"
    && state.retryCount < maxErrorRetries
  ) {
    return null;
  }

  const lastMessage = state.messages[state.messages.length - 1];
  const specialistJustFinished = lastMessage instanceof AIMessage;
  const configurationHandoff = state.lastHandoff?.agentId === SYSTEM_AGENT_ID;
  const isMultiSpecialistTurn = state.context[MULTI_SPECIALIST_TURN_CONTEXT_KEY] === true;

  if (!specialistJustFinished) {
    return null;
  }

  if (configurationHandoff) {
    return {
      next: POST_HANDOFF_FINISH_ROUTE,
      routingFailureContext: null,
      lastHandoff: state.lastHandoff,
    };
  }

  if (state.lastHandoff.status === "ok" && !isMultiSpecialistTurn) {
    return {
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      executionQueue: [],
      retryCount: 0,
      context: clearDelegationContext(),
    };
  }

  return null;
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
    multiSpecialistTurn?: boolean;
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
      retryCount: 0,
      messages: [new AIMessage(reply)],
      context: clearDelegationContext(),
    };
  }

  const effectivePlan = resolveEffectiveExecutionPlan(response);

  if (
    options?.lastHandoff
    && isAutoRetryableErrorRoute(options.lastHandoff, response, retryCount, maxErrorRetries)
  ) {
    return {
      ...enqueueAndStart(effectivePlan, {
        priorHandoff: options.lastHandoff,
      }),
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
      return enqueueAndStart(remaining, {
        priorHandoff: options.lastHandoff,
        continuingMultiSpecialistTurn: true,
      });
    }

    return {
      next: POST_HANDOFF_FINISH_ROUTE,
      lastHandoff: options.lastHandoff,
      routingFailureContext: null,
      executionQueue: [],
      retryCount: 0,
    };
  }

  if (effectivePlan.length === 0) {
    return onFailure("Missing runtime agent route.");
  }

  for (const step of effectivePlan) {
    if (!enabledAgentIds.has(step.agentId)) {
      return onFailure(`Unknown or disabled runtime agent route: ${step.agentId}`);
    }
  }

  if (response.reply !== undefined) {
    console.warn(
      `Supervisor routing ignored a reply while delegating to ${effectivePlan.map((step) => step.agentId).join(" → ")}.`,
    );
  }

  return enqueueAndStart(effectivePlan, {
    continuingMultiSpecialistTurn: options?.multiSpecialistTurn === true,
  });
};

export const formatExecutionPlanLog = (
  steps: ReadonlyArray<{ agentId: string }>,
): string => steps.map((step) => step.agentId).join(" → ");
