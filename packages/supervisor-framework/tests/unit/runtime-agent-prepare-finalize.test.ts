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
import { RUNTIME_AGENT_CONTEXT_KEY } from "../../src/core/types/agent.js";

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
    } as AgentState);

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
});
