import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { Overwrite } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import {
  createRuntimeAgentFinalizeNode,
  createRuntimeAgentPrepareNode,
} from "../../src/core/agents/build-runtime-agent-nodes.js";
import type { RuntimeAgentGraphBundle } from "../../src/core/agents/runtime-agent-graph-bundle.js";
import { getRuntimeAgentIdFromMessage } from "../../src/core/execution/sub-agent-messages.js";
import type { AgentState } from "../../src/core/state.js";
import {
  DELEGATION_TASK_CONTEXT_KEY,
  PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY,
  RUNTIME_AGENT_CONTEXT_KEY,
} from "../../src/core/types/agent.js";

const createBundle = (
  overrides: Partial<RuntimeAgentGraphBundle> = {},
): RuntimeAgentGraphBundle => ({
  name: "Finance",
  maxSteps: 4,
  prepare: () => ({ agentMessages: [], stepCount: 0 }),
  llmNode: async () => ({ agentMessages: [], stepCount: 0 }),
  toolsNode: async () => ({}),
  finalize: () => ({ messages: [new AIMessage("synced")] }),
  ...overrides,
});

const unwrapOverwrite = <T>(value: T | Overwrite<T>): T =>
  value instanceof Overwrite ? value.value : value;

describe("createRuntimeAgentFinalizeNode", () => {
  it("tags handoff AI messages with runtimeAgentId", () => {
    const finalize = createRuntimeAgentFinalizeNode(createBundle(), "finance");
    const update = finalize({
      messages: [new HumanMessage("sync expenses")],
      agentMessages: [new AIMessage("synced")],
      stepCount: 1,
      context: {},
    } as AgentState);

    const messages = Array.isArray(update.messages) ? update.messages : [];
    expect(messages).toHaveLength(1);
    expect(getRuntimeAgentIdFromMessage(messages[0]!)).toBe("finance");
    expect(messages[0]?.additional_kwargs?.[RUNTIME_AGENT_CONTEXT_KEY]).toBe("finance");
  });

  it("does not attach a supervisor rewrite to the completed handoff", () => {
    const finalize = createRuntimeAgentFinalizeNode(createBundle(), "finance");
    const update = finalize({
      messages: [new HumanMessage("add expense")],
      agentMessages: [new AIMessage("added")],
      stepCount: 1,
      context: {},
    } as AgentState);

    expect(update.lastHandoff).toMatchObject({
      agentId: "finance",
      status: "ok",
      resultSummary: "synced",
    });
    expect(update.lastHandoff).not.toHaveProperty("delegationPrompt");
  });

  it("tags freshly built finalize AI messages from mapResult", () => {
    const finalize = createRuntimeAgentFinalizeNode(
      createBundle({
        finalize: () => ({ messages: [new AIMessage("summary from tools")] }),
      }),
      "obsidian",
    );

    const update = finalize({
      messages: [],
      agentMessages: [new AIMessage("")],
      stepCount: 2,
      context: {},
    } as unknown as AgentState);

    const messages = Array.isArray(update.messages) ? update.messages : [];
    expect(getRuntimeAgentIdFromMessage(messages[0]!)).toBe("obsidian");
  });
});

describe("createRuntimeAgentPrepareNode", () => {
  it("scopes from parent messages by agentId, ignoring foreign history", () => {
    const prepare = createRuntimeAgentPrepareNode(createBundle(), "obsidian");
    const update = prepare({
      messages: [
        new HumanMessage("sync expenses"),
        new AIMessage({
          content: "No new transactions.",
          additional_kwargs: { [RUNTIME_AGENT_CONTEXT_KEY]: "finance" },
        }),
        new HumanMessage("Show today's plan."),
      ],
      context: {},
    } as AgentState);

    expect(unwrapOverwrite(update.agentMessages as never)).toEqual([
      new HumanMessage("Show today's plan."),
    ]);
    expect(update.stepCount).toBe(0);
  });

  it("appends a delegation brief after scoped history", () => {
    const prepare = createRuntimeAgentPrepareNode(createBundle(), "obsidian");
    const update = prepare({
      messages: [new HumanMessage("Show today's plan and yesterday's expenses")],
      context: {
        [DELEGATION_TASK_CONTEXT_KEY]: "Show today's plan only.",
        [PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY]: "Yesterday: 2 expenses.",
      },
    } as unknown as AgentState);

    expect(unwrapOverwrite(update.agentMessages as never)).toEqual([
      new HumanMessage("Show today's plan and yesterday's expenses"),
      new HumanMessage(
        [
          "Prior specialist result:",
          "Yesterday: 2 expenses.",
          "",
          "Supervisor task:",
          "Show today's plan only.",
        ].join("\n"),
      ),
    ]);
  });

  it("does not place the brief next to an older same-agent human", () => {
    const prepare = createRuntimeAgentPrepareNode(createBundle(), "obsidian");
    const update = prepare({
      messages: [
        new HumanMessage("you created today's note with incorrect entries, fix it"),
        new AIMessage({
          content: "I have cleaned up the note.",
          additional_kwargs: { [RUNTIME_AGENT_CONTEXT_KEY]: "obsidian" },
        }),
        new HumanMessage("show today's plan"),
      ],
      context: {
        [DELEGATION_TASK_CONTEXT_KEY]: "Show today's plan from the daily note.",
      },
    } as unknown as AgentState);

    const agentMessages = unwrapOverwrite(update.agentMessages as never);
    expect(agentMessages[0]).toEqual(
      new HumanMessage("you created today's note with incorrect entries, fix it"),
    );
    expect(agentMessages.at(-1)).toEqual(
      new HumanMessage("Supervisor task:\nShow today's plan from the daily note."),
    );
    expect(agentMessages.at(-2)).toEqual(new HumanMessage("show today's plan"));
    expect(String(agentMessages[1]?.content)).toBe("I have cleaned up the note.");
  });
});
