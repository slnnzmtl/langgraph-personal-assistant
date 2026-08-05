import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import type { RuntimeAgentHandoff } from "../../src/core/execution/runtime-agent-handoff.js";
import {
  buildPostHandoffReplanHint,
  DEFAULT_MAX_ERROR_RETRIES,
  detectCompletionState,
  isAffirmativeFollowUp,
  isAutoRetryableErrorRoute,
  isBlockedRepeatRoute,
  isExplicitRetryRequest,
  resolveRoutingDecision,
} from "../../src/core/supervisor/helpers.js";
import { POST_HANDOFF_FINISH_ROUTE } from "../../src/core/state.js";

const completeHandoff = (
  agentId: string,
  status: RuntimeAgentHandoff["status"] = "ok",
  delegationPrompt?: string,
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName: agentId,
  status,
  ...(delegationPrompt !== undefined ? { delegationPrompt } : {}),
});

const baseState = {
  agentMessages: [],
  stepCount: 0,
  next: undefined,
  executionQueue: [],
  delegationPrompt: null,
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
        executionQueue: [{ agentId: "obsidian", prompt: "Show today's plan." }],
        lastHandoff: completeHandoff("finance"),
      },
      "yes",
    );

    expect(hint).toBeNull();
  });

  it("blocks an immediate non-affirmative repeat route to the same agent", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", prompt: "Show yesterday's expenses.", reply: undefined },
      "show yesterday's expenses",
    )).toBe(true);
  });

  it("blocks same-agent routing when the delegation prompt matches the completed handoff", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance", "ok", "Show yesterday's expenses."),
      { next: "finance", prompt: "Show yesterday's expenses.", reply: undefined },
      "show yesterday's expenses",
    )).toBe(true);
  });

  it("allows same-agent routing when the delegation prompt differs from the completed handoff", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance", "ok", "Add 115 USD for Donation to Andrii to yesterday's expenses."),
      { next: "finance", prompt: "Add 115 USD for Donation to Andrii to today's expenses.", reply: undefined },
      "this is today",
    )).toBe(false);
  });

  it("allows same-agent routing on affirmative follow-ups", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", prompt: "Sync expenses.", reply: undefined },
      "yes",
    )).toBe(false);
  });

  it("allows FINISH after a complete handoff", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "FINISH", reply: "Synced 5 transactions.", prompt: undefined },
      "yes",
    )).toBe(false);
  });

  it("allows repeat routes when the user explicitly retries", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", prompt: "Retry the sync.", reply: undefined },
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
      { next: "configuration", prompt: "Create trainer with valid capabilities.", reply: undefined },
      0,
    )).toBe(true);
  });

  it("blocks auto-retry routing once the retry budget is exhausted", () => {
    expect(isAutoRetryableErrorRoute(
      completeHandoff("configuration", "error"),
      { next: "configuration", prompt: "Create trainer with valid capabilities.", reply: undefined },
      DEFAULT_MAX_ERROR_RETRIES,
    )).toBe(false);
  });

  it("increments retryCount when auto-retrying after an error handoff", async () => {
    const result = await resolveRoutingDecision(
      { next: "configuration", prompt: "Create trainer with none capability.", reply: undefined },
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
      { next: "FINISH", reply: "Could not create the trainer agent.", prompt: undefined },
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

  it("returns null when a non-configuration specialist returns in the same turn", () => {
    expect(detectCompletionState({
      ...baseState,
      messages: [new HumanMessage("sync expenses"), new AIMessage("Synced 5 transactions.")],
      lastHandoff: completeHandoff("finance"),
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
});
