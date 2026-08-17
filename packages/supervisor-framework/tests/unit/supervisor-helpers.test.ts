import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import type { RuntimeAgentHandoff } from "../../src/core/execution/runtime-agent-handoff.js";
import {
  buildExecutionContext,
  buildPostHandoffReplanHint,
  DEFAULT_MAX_ERROR_RETRIES,
  detectCompletionState,
  enqueueAndStart,
  isAffirmativeFollowUp,
  isAutoRetryableErrorRoute,
  isBlockedRepeatRoute,
  isExplicitRetryRequest,
  resolveEffectiveExecutionPlan,
  resolveRoutingDecision,
} from "../../src/core/supervisor/helpers.js";
import {
  DELEGATION_TASK_CONTEXT_KEY,
  MULTI_SPECIALIST_TURN_CONTEXT_KEY,
  PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY,
  RUNTIME_AGENT_CONTEXT_KEY,
} from "../../src/core/types/agent.js";
import { FINISH_ROUTE, POST_HANDOFF_FINISH_ROUTE } from "../../src/core/state.js";

const completeHandoff = (
  agentId: string,
  status: RuntimeAgentHandoff["status"] = "ok",
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName: agentId,
  status,
});

const baseState = {
  agentMessages: [],
  stepCount: 0,
  next: undefined,
  executionQueue: [],
  context: {},
  handoffStatus: undefined,
  routingFailureContext: null,
  retryCount: 0,
};

describe("supervisor replan helpers", () => {
  it("detects affirmative follow-ups", () => {
    expect(isAffirmativeFollowUp("yes")).toBe(true);
    expect(isAffirmativeFollowUp("Sure.")).toBe(true);
    expect(isAffirmativeFollowUp("sync expenses")).toBe(false);
  });

  it("detects explicit retry requests", () => {
    expect(isExplicitRetryRequest("retry finance sync")).toBe(true);
    expect(isExplicitRetryRequest("please try again")).toBe(true);
    expect(isExplicitRetryRequest("yes")).toBe(false);
  });

  it("builds a post-handoff replan hint after a complete handoff with an empty queue", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        lastHandoff: completeHandoff("finance"),
      },
      "yes",
    );

    expect(hint).toContain('runtime agent "finance" just completed');
    expect(hint).toContain("Latest user message: yes");
    expect(hint).toContain("specialist's actual findings");
    expect(hint).toContain("resolve short or ambiguous replies using the prior assistant turn");
    expect(hint).toContain("affirmative follow-up");
    expect(hint).toContain("offered NEW work");
  });

  it("returns null when the execution queue still has steps", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        executionQueue: [{ agentId: "obsidian" }],
        lastHandoff: completeHandoff("finance"),
      },
      "yes",
    );

    expect(hint).toBeNull();
  });

  it("returns null when the last handoff is empty", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        lastHandoff: completeHandoff("finance", "empty"),
      },
      "show yesterday's expenses",
    );

    expect(hint).toBeNull();
  });

  it("blocks an immediate non-affirmative repeat route to the same agent", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", reply: undefined },
      "show yesterday's expenses",
    )).toBe(true);
  });

  it("allows same-agent routing on affirmative follow-ups", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", reply: undefined },
      "yes",
    )).toBe(false);
  });

  it("allows FINISH after a complete handoff", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "FINISH", reply: "Synced 5 transactions." },
      "yes",
    )).toBe(false);
  });

  it("allows repeat routes when the user explicitly retries", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", reply: undefined },
      "retry finance sync",
    )).toBe(false);
  });

  it("routes to post_handoff_finish when configuration returns in the same turn", () => {
    expect(detectCompletionState({
      ...baseState,
      messages: [new HumanMessage("list agents"), new AIMessage("Agent ID: finance")],
      lastHandoff: completeHandoff("configuration"),
    })).toEqual({
      next: POST_HANDOFF_FINISH_ROUTE,
      routingFailureContext: null,
      lastHandoff: completeHandoff("configuration"),
    });
  });

  it("returns null when configuration failed with error and retries remain", () => {
    expect(detectCompletionState({
      ...baseState,
      retryCount: 0,
      messages: [
        new HumanMessage("create trainer"),
        new AIMessage("Invalid capability."),
      ],
      lastHandoff: completeHandoff("configuration", "error"),
    })).toBeNull();
  });

  it("routes to post_handoff_finish when configuration error retries are exhausted", () => {
    expect(detectCompletionState({
      ...baseState,
      retryCount: DEFAULT_MAX_ERROR_RETRIES,
      messages: [
        new HumanMessage("create trainer"),
        new AIMessage("Invalid capability."),
      ],
      lastHandoff: completeHandoff("configuration", "error"),
    })).toEqual({
      next: POST_HANDOFF_FINISH_ROUTE,
      routingFailureContext: null,
      lastHandoff: completeHandoff("configuration", "error"),
    });
  });

  it("includes retry guidance in post-handoff hint for errored handoffs", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        retryCount: 1,
        lastHandoff: completeHandoff("configuration", "error"),
      },
      "create trainer",
    );

    expect(hint).toContain('status "error"');
    expect(hint).toContain("automatic retry");
    expect(hint).toContain('"configuration"');
  });

  it("includes exhausted retry guidance when the error retry budget is spent", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        retryCount: DEFAULT_MAX_ERROR_RETRIES,
        lastHandoff: completeHandoff("configuration", "error"),
      },
      "create trainer",
    );

    expect(hint).toContain("Retry budget exhausted");
    expect(hint).toContain("FINISH and explain the failure");
  });

  it("allows auto-retry routing to the same agent after an error handoff", () => {
    expect(isAutoRetryableErrorRoute(
      completeHandoff("configuration", "error"),
      { next: "configuration", reply: undefined },
      0,
    )).toBe(true);
  });

  it("blocks auto-retry routing once the retry budget is exhausted", () => {
    expect(isAutoRetryableErrorRoute(
      completeHandoff("configuration", "error"),
      { next: "configuration", reply: undefined },
      DEFAULT_MAX_ERROR_RETRIES,
    )).toBe(false);
  });

  it("increments retryCount when auto-retrying after an error handoff", async () => {
    const result = await resolveRoutingDecision(
      { next: "configuration", reply: undefined },
      new Set(["configuration"]),
      async () => ({ next: "failure" }),
      {
        lastHandoff: completeHandoff("configuration", "error"),
        latestUserText: "create trainer",
        retryCount: 0,
        maxErrorRetries: DEFAULT_MAX_ERROR_RETRIES,
      },
    );

    expect(result.next).toBe("configuration");
    expect(result.retryCount).toBe(1);
  });

  it("resets retryCount to zero on FINISH", async () => {
    const result = await resolveRoutingDecision(
      { next: "FINISH", reply: "Could not create the trainer agent." },
      new Set(["configuration"]),
      async () => ({ next: "failure" }),
      {
        lastHandoff: completeHandoff("configuration", "error"),
        latestUserText: "create trainer",
        retryCount: 2,
      },
    );

    expect(result.next).toBe("FINISH");
    expect(result.retryCount).toBe(0);
  });

  it("returns FINISH without a new message when a non-configuration specialist completes a single-agent turn", () => {
    expect(detectCompletionState({
      ...baseState,
      messages: [new HumanMessage("sync expenses"), new AIMessage("Synced 5 transactions.")],
      lastHandoff: completeHandoff("finance"),
    })).toEqual({
      next: FINISH_ROUTE,
      lastHandoff: null,
      routingFailureContext: null,
      executionQueue: [],
      retryCount: 0,
      context: {
        [RUNTIME_AGENT_CONTEXT_KEY]: null,
        [DELEGATION_TASK_CONTEXT_KEY]: null,
        [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: null,
        [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: null,
      },
    });
  });

  it("falls through to supervisor synthesis after a multi-specialist turn", () => {
    expect(detectCompletionState({
      ...baseState,
      messages: [new HumanMessage("plan and expenses"), new AIMessage("Note saved.")],
      lastHandoff: completeHandoff("obsidian"),
      context: { [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: true },
    })).toBeNull();
  });

  it("returns null when the user sends a new message after a complete handoff", () => {
    expect(detectCompletionState({
      ...baseState,
      messages: [
        new HumanMessage("list agents"),
        new AIMessage("Agent ID: finance"),
        new HumanMessage("thanks"),
      ],
      lastHandoff: completeHandoff("configuration"),
    })).toBeNull();
  });

  it("builds a single-agent plan from next without a task brief", () => {
    expect(resolveEffectiveExecutionPlan({
      next: "finance",
      reply: undefined,
    })).toEqual([{ agentId: "finance" }]);
  });

  it("preserves per-step tasks on a queued plan, including a one-item queue", () => {
    expect(resolveEffectiveExecutionPlan({
      next: "finance",
      queue: [{ agentId: "finance", task: "only yesterday" }],
      reply: undefined,
    })).toEqual([{ agentId: "finance", task: "only yesterday" }]);

    expect(resolveEffectiveExecutionPlan({
      next: "obsidian",
      queue: [
        { agentId: "obsidian", task: "today's plan" },
        { agentId: "finance" },
      ],
      reply: undefined,
    })).toEqual([
      { agentId: "obsidian", task: "today's plan" },
      { agentId: "finance" },
    ]);
  });

  it("always writes delegation context keys, including nulls", () => {
    expect(buildExecutionContext({ agentId: "finance" }, { multiSpecialistTurn: false })).toEqual({
      [RUNTIME_AGENT_CONTEXT_KEY]: "finance",
      [DELEGATION_TASK_CONTEXT_KEY]: null,
      [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: null,
      [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: null,
    });
  });

  it("pipes the prior specialist summary when dequeuing the next agent", () => {
    const prior = {
      ...completeHandoff("finance"),
      resultSummary: "Synced 5 transactions.",
    };
    const update = enqueueAndStart(
      [{ agentId: "obsidian", task: "Write a note with those expenses." }],
      { priorHandoff: prior, continuingMultiSpecialistTurn: true },
    );

    expect(update.next).toBe("obsidian");
    expect(update.context).toEqual({
      [RUNTIME_AGENT_CONTEXT_KEY]: "obsidian",
      [DELEGATION_TASK_CONTEXT_KEY]: "Write a note with those expenses.",
      [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: "Synced 5 transactions.",
      [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: true,
    });
  });

  it("includes the specialist result summary in the post-handoff replan hint", () => {
    const hint = buildPostHandoffReplanHint(
      {
        ...baseState,
        messages: [],
        lastHandoff: {
          ...completeHandoff("finance"),
          resultSummary: "Synced 5 transactions.",
        },
      },
      "sync expenses",
    );

    expect(hint).toContain("Specialist result summary: Synced 5 transactions.");
  });

  it("dequeues the next queued agent with the prior result summary", () => {
    const update = detectCompletionState({
      ...baseState,
      messages: [new HumanMessage("plan and expenses"), new AIMessage("Synced 5 transactions.")],
      lastHandoff: {
        ...completeHandoff("finance"),
        resultSummary: "Synced 5 transactions.",
      },
      executionQueue: [{ agentId: "obsidian", task: "Show today's plan only." }],
    });

    expect(update?.next).toBe("obsidian");
    expect(update?.context).toMatchObject({
      [RUNTIME_AGENT_CONTEXT_KEY]: "obsidian",
      [DELEGATION_TASK_CONTEXT_KEY]: "Show today's plan only.",
      [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: "Synced 5 transactions.",
      [MULTI_SPECIALIST_TURN_CONTEXT_KEY]: true,
    });
  });
});
