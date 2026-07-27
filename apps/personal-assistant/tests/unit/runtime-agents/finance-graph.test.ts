import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../../src/mcp/supabase.js";
import { createCompiledSubAgentGraph } from "../../helpers/compiled-sub-agent.js";
import { createTestRuntimeAgentNode, financeRuntimeNodeConfig } from "../../helpers/policy-nodes.js";
import { resolveAgentSkillModule } from "@personal-assistant/supervisor-framework";
import { createFinanceTestTools } from "../../helpers/finance-tools.js";
import { FakeLLMConnector, getRuntimeAgentFixture } from "../../helpers/fakes.js";

const financeDefinition = getRuntimeAgentFixture("finance");
const financeSkillModule = resolveAgentSkillModule(financeDefinition);

const createCompiledFinanceSubgraph = (
  model: ReturnType<FakeLLMConnector["getModel"]>,
  tools: ReturnType<typeof createFinanceTestTools>,
) => createCompiledSubAgentGraph(
  "Finance",
  financeDefinition.maxSteps,
  createTestRuntimeAgentNode(model, financeDefinition, tools, financeRuntimeNodeConfig()),
  tools,
);

describe("finance subgraph tool batching", () => {
  it("skips the LLM when a tool batch is only partially complete", async () => {
    let financeCalls = 0;
    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      return new AIMessage("should not run");
    }).getModel();
    const financeNode = createTestRuntimeAgentNode(model, financeDefinition, [], financeRuntimeNodeConfig());

    const update = await financeNode({
      agentMessages: [
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
    expect(update.agentMessages).toBeUndefined();
    expect(update.stepCount).toBe(1);
  });

  it("prompts the model once after all parallel tool calls finish", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(mockSession, financeSkillModule);
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
      agentMessages: [new HumanMessage("sync finances")],
      stepCount: 0,
    });

    expect(financeCalls).toBeGreaterThanOrEqual(2);
    expect(result.agentMessages.at(-1)?.content).toBe("Finance sync completed.");
  });

  it("hands empty replies to the supervisor with last tool context", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector(() => {
      financeCalls += 1;
      return new AIMessage("");
    }).getModel();

    const financeNode = createTestRuntimeAgentNode(model, financeDefinition, tools, financeRuntimeNodeConfig());
    const update = await financeNode({
      agentMessages: [
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
    const emptyReply = update.agentMessages?.[0] as AIMessage;
    expect(emptyReply.content).toBe("");
    expect(emptyReply.additional_kwargs).toEqual({});
  });

  it("retries the model when it returns empty after exec_sql so the agent answers", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([{ max: "2026-07-16" }]),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(mockSession, financeSkillModule);
    let financeCalls = 0;
    const invokeInputs: unknown[] = [];

    const model = new FakeLLMConnector((input) => {
      financeCalls += 1;
      invokeInputs.push(input);
      if (financeCalls === 1) {
        return new AIMessage("");
      }
      return new AIMessage("The last expense date in the database is 2026-07-16.");
    }).getModel();

    const financeNode = createTestRuntimeAgentNode(model, financeDefinition, tools, financeRuntimeNodeConfig());
    const update = await financeNode({
      agentMessages: [
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
    expect(update.agentMessages?.[0]?.content).toBe("The last expense date in the database is 2026-07-16.");
    const recoveryInput = invokeInputs[1] as Array<{ content?: unknown }>;
    expect(String(recoveryInput.at(-1)?.content)).toContain("Your previous response was empty after a tool result.");
  });

  it("recovers from ambiguous verification SQL after an empty candidate", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(mockSession, financeSkillModule);
    let financeCalls = 0;
    const ambiguousError = JSON.stringify({
      error: {
        message: 'Failed to run sql query: ERROR:  42702: column reference "id" is ambiguous',
      },
    });

    const model = new FakeLLMConnector(() => {
      financeCalls += 1;

      if (financeCalls === 1) {
        return new AIMessage("");
      }

      if (financeCalls === 2) {
        return new AIMessage({
          content: "",
          tool_calls: [{
            name: "exec_sql",
            args: {
              sql: "SELECT e.id, e.name, e.amount, e.paid_date, e.category, c.name AS category_name FROM public.expense AS e LEFT JOIN public.category AS c ON e.category = c.id WHERE e.id IN (1634, 1633)",
            },
            id: "verify-2",
            type: "tool_call",
          }],
        });
      }

      return new AIMessage(
        "Updated both UNIQLO expenses to Shop: 34.00 and 37.00 on 2026-07-19.",
      );
    }).getModel();

    const subgraph = createCompiledFinanceSubgraph(model, tools);
    const result = await subgraph.invoke({
      agentMessages: [
        new HumanMessage("uniqlo is clothes"),
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "exec_sql",
            args: { sql: "UPDATE public.expense SET category = 33 WHERE id IN (1634, 1633)" },
            id: "update-1",
            type: "tool_call",
          }],
        }),
        new ToolMessage({ tool_call_id: "update-1", name: "exec_sql", content: "[]" }),
        new AIMessage({
          content: "",
          tool_calls: [{
            name: "exec_sql",
            args: {
              sql: "SELECT id, name, amount, paid_date, category, c.name AS category_name FROM public.expense AS e LEFT JOIN public.category AS c ON e.category = c.id WHERE e.id IN (1634, 1633)",
            },
            id: "verify-1",
            type: "tool_call",
          }],
        }),
        new ToolMessage({ tool_call_id: "verify-1", name: "exec_sql", content: ambiguousError }),
      ],
      stepCount: 2,
    });

    expect(financeCalls).toBeGreaterThanOrEqual(3);
    expect(result.agentMessages.at(-1)?.content).toBe(
      "Updated both UNIQLO expenses to Shop: 34.00 and 37.00 on 2026-07-19.",
    );
  });

  it("completes the remaining tool call before prompting the model", async () => {
    const mockSession: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    const tools = createFinanceTestTools(mockSession, financeSkillModule);
    let financeCalls = 0;

    const model = new FakeLLMConnector((input) => {
      financeCalls += 1;
      const toolResults = input.filter((message: { _getType?: () => string }) => message._getType?.() === "tool");

      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      return new AIMessage("Done after the full batch.");
    }).getModel();

    const subgraph = createCompiledFinanceSubgraph(model, tools);
    const partialState = {
      agentMessages: [
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
    expect(result.agentMessages.at(-1)?.content).toBe("Done after the full batch.");
  });
});
