import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { ILLMConnector } from "../../src/connectors/llm-connector.js";
import type { RuntimeAgentHandoff } from "@personal-assistant/supervisor-framework";
import { createEmptyReplyNode } from "@personal-assistant/supervisor-framework";
import { createFailureReplyNode } from "@personal-assistant/supervisor-framework";
import { createPostHandoffFinishNode } from "@personal-assistant/supervisor-framework";
import { FINISH_ROUTE } from "@personal-assistant/supervisor-framework";
import { loadSupervisorSystemPrompt } from "../../src/agents/load-system-prompt.js";
import { firstStateUpdateMessage } from "../helpers/fakes.js";

const emptyHandoff = (
  agentName: string,
  agentId: string,
  toolContext = "",
): RuntimeAgentHandoff => ({
  kind: "runtime-agent-handoff",
  agentId,
  agentName,
  status: "empty",
  toolContext,
});

describe("supervisor reply nodes", () => {
  it("empty_reply summarizes an empty runtime agent handoff", async () => {
    const modelInvoke = vi.fn(async () =>
      new AIMessage("I couldn't finish that step cleanly. Please try again."),
    );
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "obsidian" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const emptyReplyNode = createEmptyReplyNode(connector);

    const result = await emptyReplyNode({
      messages: [new HumanMessage("today's plan")],
      lastHandoff: emptyHandoff("Obsidian", "obsidian"),
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(firstStateUpdateMessage(result)?.content).toBe(
      "I couldn't finish that step cleanly. Please try again.",
    );
    expect(result.lastHandoff).toBeNull();
    expect(modelInvoke).toHaveBeenCalledOnce();
  });

  it("empty_reply includes tool context from the handoff", async () => {
    const modelInvoke = vi.fn(async (input: unknown) => {
      const messages = input as Array<{ content?: unknown }>;
      const systemText = String(messages[0]?.content ?? "");
      expect(systemText).toContain("exec_sql:");
      expect(systemText).toContain("expenses");
      expect(systemText).toContain("does not exist");
      expect(systemText).not.toContain("You are the Root Supervisor");
      return new AIMessage("The query failed because the expenses table name was wrong.");
    });
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "finance" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const emptyReplyNode = createEmptyReplyNode(connector);

    const result = await emptyReplyNode({
      messages: [new HumanMessage("for yesterday only")],
      lastHandoff: emptyHandoff(
        "Finance",
        "finance",
        'exec_sql: {"error":{"message":"relation \\"expenses\\" does not exist"}}',
      ),
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(firstStateUpdateMessage(result)?.content).toBe(
      "The query failed because the expenses table name was wrong.",
    );
    expect(result.lastHandoff).toBeNull();
  });

  it("empty_reply rejects routing JSON and falls back to tool context", async () => {
    const modelInvoke = vi.fn(async (input: unknown) => {
      const messages = input as Array<{ content?: unknown }>;

      expect(messages).toHaveLength(2);
      expect(String(messages[0]?.content)).not.toContain("You are the Root Supervisor");
      expect(String(messages[1]?.content)).toBe("it is shop");

      return new AIMessage(JSON.stringify({
        next: "finance",
        reply: "I will update Moonmilk to Shop.",
      }));
    });
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "finance" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const emptyReplyNode = createEmptyReplyNode(connector);
    const toolContext = 'exec_sql: [{"name":"Moonmilk","amount":20,"category":"Shop","paid_date":"2026-07-20"}]';

    const result = await emptyReplyNode({
      messages: [
        new HumanMessage("Moonmilk is not debt"),
        new AIMessage("What category should Moonmilk use?"),
        new HumanMessage("it is shop"),
      ],
      lastHandoff: emptyHandoff("Finance", "finance", toolContext),
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(firstStateUpdateMessage(result)?.content).toBe(
      `Finance did not produce a reliable summary. Its last tool result was:\n${toolContext}`,
    );
  });

  it("post_handoff_finish reuses a specialist reply when one is already in the thread", async () => {
    const modelInvoke = vi.fn();
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "finance" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const postHandoffFinishNode = createPostHandoffFinishNode(connector);

    const result = await postHandoffFinishNode({
      messages: [
        new HumanMessage("sync expenses"),
        new AIMessage("Synced 5 Wise transactions."),
      ],
      lastHandoff: {
        kind: "runtime-agent-handoff",
        agentId: "finance",
        agentName: "Finance",
        status: "ok",
      },
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(result.messages).toBeUndefined();
    expect(modelInvoke).not.toHaveBeenCalled();
  });

  it("post_handoff_finish falls back to tool context when the model returns empty", async () => {
    const modelInvoke = vi.fn(async () => new AIMessage(""));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => ({ next: "finance" }),
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const postHandoffFinishNode = createPostHandoffFinishNode(connector);
    const toolContext = "fetch_wise_transactions: Fetched and normalized 5 Wise transactions";

    const result = await postHandoffFinishNode({
      messages: [new HumanMessage("sync expenses")],
      lastHandoff: {
        kind: "runtime-agent-handoff",
        agentId: "finance",
        agentName: "Finance",
        status: "ok",
        toolContext,
      },
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(firstStateUpdateMessage(result)?.content).toBe(
      "Finance completed your request: sync expenses. Tool results:\nfetch_wise_transactions: Fetched and normalized 5 Wise transactions",
    );
    expect(modelInvoke).toHaveBeenCalledOnce();
  });

  it("failure_reply generates a user-facing explanation from routingFailureContext", async () => {
    const modelInvoke = vi.fn(async () => new AIMessage("Final explanatory answer"));
    const connector: ILLMConnector = {
      bindRoutingTools: () => ({
        invoke: async () => {
          throw new Error("schema parse failed");
        },
      }),
      getModel: () => ({
        invoke: modelInvoke,
      } as unknown as BaseChatModel),
    };
    const failureReplyNode = createFailureReplyNode(connector, {
      loadSupervisorPrompt: loadSupervisorSystemPrompt,
    });

    const result = await failureReplyNode({
      messages: [new HumanMessage("hello")],
      routingFailureContext: "Structured routing failed: schema parse failed",
      context: {},
      next: undefined,
    });

    expect(result.next).toBe(FINISH_ROUTE);
    expect(firstStateUpdateMessage(result)?.content).toBe("Final explanatory answer");
    expect(result.routingFailureContext).toBeNull();
    expect(modelInvoke).toHaveBeenCalledOnce();
  });
});
