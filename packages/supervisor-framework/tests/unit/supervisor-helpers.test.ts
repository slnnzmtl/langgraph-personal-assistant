import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import type { RuntimeAgentHandoff } from "../../src/core/execution/runtime-agent-handoff.js";
import {
  buildPostHandoffReplanHint,
  detectCompletionState,
  isAffirmativeFollowUp,
  isBlockedRepeatRoute,
  isExplicitRetryRequest,
} from "../../src/core/supervisor/helpers.js";
import { POST_HANDOFF_FINISH_ROUTE } from "../../src/core/state.js";

const completeHandoff = (agentId: string): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName: agentId,
  status: "ok",
});

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
        messages: [],
        agentMessages: [],
        stepCount: 0,
        next: undefined,
        executionQueue: [],
        delegationPrompt: null,
        context: {},
        lastHandoff: completeHandoff("finance"),
        handoffStatus: undefined,
        routingFailureContext: null,
      },
      "yes",
    );

    expect(hint).toContain('runtime agent "finance" just completed');
    expect(hint).toContain("Latest user message: yes");
    expect(hint).toContain("affirmative follow-up");
  });

  it("returns null when the execution queue still has steps", () => {
    const hint = buildPostHandoffReplanHint(
      {
        messages: [],
        agentMessages: [],
        stepCount: 0,
        next: undefined,
        executionQueue: [{ agentId: "obsidian", prompt: "Show today's plan." }],
        delegationPrompt: null,
        context: {},
        lastHandoff: completeHandoff("finance"),
        handoffStatus: undefined,
        routingFailureContext: null,
      },
      "yes",
    );

    expect(hint).toBeNull();
  });

  it("blocks an immediate repeat route to the same agent", () => {
    expect(isBlockedRepeatRoute(
      completeHandoff("finance"),
      { next: "finance", prompt: "Sync expenses.", reply: undefined },
      "yes",
    )).toBe(true);
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
      messages: [new HumanMessage("list agents"), new AIMessage("Agent ID: finance")],
      agentMessages: [],
      stepCount: 0,
      next: undefined,
      executionQueue: [],
      delegationPrompt: null,
      context: {},
      lastHandoff: completeHandoff("configuration"),
      handoffStatus: undefined,
      routingFailureContext: null,
    })).toEqual({
      next: POST_HANDOFF_FINISH_ROUTE,
      routingFailureContext: null,
      lastHandoff: completeHandoff("configuration"),
    });
  });

  it("returns null when a non-configuration specialist returns in the same turn", () => {
    expect(detectCompletionState({
      messages: [new HumanMessage("sync expenses"), new AIMessage("Synced 5 transactions.")],
      agentMessages: [],
      stepCount: 0,
      next: undefined,
      executionQueue: [],
      delegationPrompt: null,
      context: {},
      lastHandoff: completeHandoff("finance"),
      handoffStatus: undefined,
      routingFailureContext: null,
    })).toBeNull();
  });

  it("returns null when the user sends a new message after a complete handoff", () => {
    expect(detectCompletionState({
      messages: [
        new HumanMessage("list agents"),
        new AIMessage("Agent ID: finance"),
        new HumanMessage("thanks"),
      ],
      agentMessages: [],
      stepCount: 0,
      next: undefined,
      executionQueue: [],
      delegationPrompt: null,
      context: {},
      lastHandoff: completeHandoff("configuration"),
      handoffStatus: undefined,
      routingFailureContext: null,
    })).toBeNull();
  });
});
