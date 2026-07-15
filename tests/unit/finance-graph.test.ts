import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../src/mcp/supabase.js";
import { createFinanceNode } from "../../src/nodes/finance/node.js";
import { createCompiledFinanceSubgraph } from "../../src/nodes/finance/graph.js";
import { createFinanceSkillScopedTools } from "../../src/nodes/finance/tools.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

describe("finance subgraph tool batching", () => {
  it("skips the LLM when a tool batch is only partially complete", async () => {
    let financeCalls = 0;
    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      return new AIMessage("should not run");
    }).getModel();
    const financeNode = createFinanceNode(model, []);

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
    const tools = createFinanceSkillScopedTools(mockSession);
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

  it("completes the remaining tool call before prompting the model", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceSkillScopedTools(mockSession);
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
