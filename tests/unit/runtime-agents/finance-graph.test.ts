import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../../src/mcp/supabase.js";
import { createCompiledSubAgentGraph } from "../../../src/core/execution/create-sub-agent.js";
import { createFinanceNode } from "../../helpers/policy-nodes.js";
import { resolveAgentSkillModule } from "../../../src/core/types/agent.js";
import { createFinanceTools } from "../../../src/runtime-agents/policies/finance/tools.js";
import { FakeLLMConnector, getBuiltinRuntimeAgentDefinition } from "../../helpers/fakes.js";

const financeDefinition = getBuiltinRuntimeAgentDefinition("finance");
const financeSkillModule = resolveAgentSkillModule(financeDefinition);

const createCompiledFinanceSubgraph = (
  model: ReturnType<FakeLLMConnector["getModel"]>,
  tools: ReturnType<typeof createFinanceTools>,
) => createCompiledSubAgentGraph(
  "Finance",
  financeDefinition.maxSteps,
  createFinanceNode(model, financeDefinition, tools),
  tools,
);

describe("finance subgraph tool batching", () => {
  it("skips the LLM when a tool batch is only partially complete", async () => {
    let financeCalls = 0;
    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      return new AIMessage("should not run");
    }).getModel();
    const financeNode = createFinanceNode(model, financeDefinition, []);

    const update = await financeNode({
      messages: [
        new HumanMessage("sync finances"),
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "get_categories", args: {}, id: "partial-1", type: "tool_call" },
            { name: "exec_sql", args: { sql: "SELECT 1;" }, id: "partial-2", type: "tool_call" },
          ],
        }),
        new ToolMessage({ tool_call_id: "partial-1", content: "[]" }),
      ],
      stepCount: 1,
    });

    expect(financeCalls).toBe(0);
    expect(update.messages).toBeUndefined();
    expect(update.stepCount).toBe(1);
  });

  it("prompts the model once after all parallel tool calls finish", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector((input) => {
      financeCalls += 1;

      if (financeCalls === 1) {
        return new AIMessage({
          content: "",
          tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
        });
      }

      if (financeCalls === 2) {
        return new AIMessage({
          content: "",
          tool_calls: [
            { name: "get_categories", args: {}, id: "batch-1", type: "tool_call" },
            { name: "exec_sql", args: { sql: "SELECT 1;" }, id: "batch-2", type: "tool_call" },
          ],
        });
      }

      const toolResults = input.filter((message: { _getType?: () => string }) => message._getType?.() === "tool");
      expect(toolResults.length).toBeGreaterThanOrEqual(2);

      return new AIMessage("Finance sync completed.");
    }).getModel();

    const subgraph = createCompiledFinanceSubgraph(model, tools);
    const result = await subgraph.invoke({
      messages: [new HumanMessage("sync finances")],
      stepCount: 0,
    });

    expect(financeCalls).toBeGreaterThanOrEqual(2);
    expect(result.messages.at(-1)?.content).toBe("Finance sync completed.");
  });

  it("hands empty replies to the supervisor with last tool context", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      return new AIMessage("");
    }).getModel();

    const financeNode = createFinanceNode(model, financeDefinition, tools);
    const update = await financeNode({
      messages: [
        new HumanMessage("get yesterday transactions"),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
        }),
        new ToolMessage({ tool_call_id: "read-1", name: "read_skill", content: "skill body" }),
      ],
      stepCount: 1,
    });

    expect(financeCalls).toBe(2);
    const handoff = update.messages?.[0] as AIMessage;
    expect(handoff.content).toBe("");
    expect(handoff.additional_kwargs).toMatchObject({
      emptySubAgentHandoff: true,
      agentName: "Finance",
    });
    expect(String(handoff.additional_kwargs?.toolContext ?? "")).toContain("skill body");
  });

  it("retries the model when it returns empty after exec_sql so the agent answers", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([{ max: "2026-07-16" }]),
      close: vi.fn(),
    };
    const tools = createFinanceTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      if (financeCalls === 1) {
        return new AIMessage("");
      }
      return new AIMessage("The last expense date in the database is 2026-07-16.");
    }).getModel();

    const financeNode = createFinanceNode(model, financeDefinition, tools);
    const update = await financeNode({
      messages: [
        new HumanMessage("what the last expense date in db?"),
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "exec_sql",
            args: { sql: "SELECT MAX(paid_date) FROM public.expense" },
            id: "sql-1",
            type: "tool_call",
          }],
        }),
        new ToolMessage({
          name: "exec_sql",
          tool_call_id: "sql-1",
          content: JSON.stringify([{ max: "2026-07-16" }]),
        }),
      ],
      stepCount: 1,
    });

    expect(financeCalls).toBe(2);
    expect(update.messages?.[0]?.content).toBe("The last expense date in the database is 2026-07-16.");
  });

  it("completes the remaining tool call before prompting the model", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector((input) => {
      financeCalls += 1;
      const toolResults = input.filter((message: { _getType?: () => string }) => message._getType?.() === "tool");

      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      return new AIMessage("Done after the full batch.");
    }).getModel();

    const subgraph = createCompiledFinanceSubgraph(model, tools);
    const partialState = {
      messages: [
        new HumanMessage("sync finances"),
        new AIMessage({
          content: "",
          tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
        }),
        new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "skill body" }),
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "get_categories", args: {}, id: "partial-1", type: "tool_call" },
            { name: "exec_sql", args: { sql: "SELECT 1;" }, id: "partial-2", type: "tool_call" },
          ],
        }),
        new ToolMessage({ tool_call_id: "partial-1", content: "[]" }),
      ],
      stepCount: 1,
    };

    const result = await subgraph.invoke(partialState);

    expect(financeCalls).toBe(1);
    expect(result.messages.at(-1)?.content).toBe("Done after the full batch.");
  });
});
