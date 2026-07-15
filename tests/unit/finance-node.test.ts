import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../src/mcp/supabase/index.js";
import { createFinanceNode } from "../../src/nodes/finance/index.js";
import { createFinanceSkillScopedTools, getFinanceDomainTool } from "../../src/nodes/finance/tools.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const wiseTransactions = [
  {
    name: "Mpos Kokojimart",
    amount: "0.47",
    status: "COMPLETED",
    createdOn: "2026-07-12T16:31:37.354Z",
  },
  {
    name: "Mpos Poke Sake Wow",
    amount: "9.19",
    status: "COMPLETED",
    createdOn: "2026-07-12T15:59:05.023Z",
  },
];

const categories = [
  { id: 1, name: "Debts", note: null },
  { id: 4, name: "Food", note: null },
  { id: 33, name: "Shop", note: null },
];

describe("finance tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns Wise transactions as a single JSON array string", async () => {
    vi.stubEnv("WISE_API_TOKEN", "token");
    vi.stubEnv("WISE_PROFILE_ID", "profile");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        activities: wiseTransactions.map((transaction) => ({
          title: transaction.name,
          secondaryAmount: transaction.amount,
          status: transaction.status,
          createdOn: transaction.createdOn,
        })),
      }),
    }));

    const session: SupabaseMcpSession = {
      executeSql: vi.fn(),
      close: vi.fn(),
    };
    const fetchWiseTool = getFinanceDomainTool(session, "fetch_wise_transactions");

    const result = await fetchWiseTool?.invoke({
      since: "2026-07-12T00:00:00Z",
      until: "2026-07-13T00:00:00Z",
    });

    expect(JSON.parse(String(result))).toEqual(wiseTransactions);
  });

  it("returns SQL result wrappers as a single JSON array string", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ result: JSON.stringify(categories) }),
      close: vi.fn(),
    };
    const execSqlTool = getFinanceDomainTool(session, "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT id, name, note FROM public.category;" });

    expect(JSON.parse(String(result))).toEqual(categories);
  });

  it("serializes tool failures as structured error text", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
    };
    const execSqlTool = getFinanceDomainTool(session, "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT 1;" });

    expect(JSON.parse(String(result))).toEqual({ error: "database unavailable" });
  });

  it("returns all expense categories with a zero-argument tool", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ result: JSON.stringify(categories) }),
      close: vi.fn(),
    };
    const getCategoriesTool = getFinanceDomainTool(session, "get_categories");

    const result = await getCategoriesTool?.invoke({});

    expect(JSON.parse(String(result))).toEqual(categories);
  });

  it("exposes read_skill from the shared skills tool factory", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockResolvedValue({ result: JSON.stringify(categories) }),
      close: vi.fn(),
    };
    const context = createFinanceSkillScopedTools(session);
    const readSkillTool = context.config.readSkillTool;

    expect(readSkillTool).toBeDefined();

    const result = String(await readSkillTool?.invoke({ name: "sync-expenses" }));
    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("<skill_context>");
    expect(result).toContain("expense_categories:");
    expect(result).toContain('"name":"Food"');
    expect(result).toContain("<available_tools>");
    expect(result).toContain("- exec_sql:");
    expect(result).toContain("- fetch_wise_transactions:");
    expect(result).toContain("- get_categories:");
    expect(session.executeSql).toHaveBeenCalledWith("SELECT id, name, note FROM public.category;");
  });

  it("exposes only read_skill before sync-expenses is loaded", () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn(),
      close: vi.fn(),
    };
    const context = createFinanceSkillScopedTools(session);

    expect(context.resolveToolsForTurn([new HumanMessage("sync finances")]).map((tool) => tool.name)).toEqual([
      "read_skill",
    ]);
  });

  it("exposes finance domain tools after read_skill(sync-expenses)", () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn(),
      close: vi.fn(),
    };
    const context = createFinanceSkillScopedTools(session);

    const tools = context.resolveToolsForTurn([
      new HumanMessage("sync finances"),
      new AIMessage({
        content: "",
        tool_calls: [{ name: "read_skill", args: { name: "sync-expenses" }, id: "read-1", type: "tool_call" }],
      }),
      new ToolMessage({ name: "read_skill", tool_call_id: "read-1", content: "skill body" }),
    ]);

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_skill",
      "exec_sql",
      "fetch_wise_transactions",
      "get_categories",
    ]);
  });

  it("returns sync-expenses skill content when category enrichment fails", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
    };
    const context = createFinanceSkillScopedTools(session);
    const readSkillTool = context.config.readSkillTool;

    const result = String(await readSkillTool?.invoke({ name: "sync-expenses" }));

    expect(result).toContain("Sync Wise Expenses");
    expect(result).toContain("action_error expense_categories:");
    expect(result).toContain("database unavailable");
  });



  describe("step counter", () => {
    it("resets stepCount to 1 on initial entry (last message is HumanMessage)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [new HumanMessage("sync finances")],
        stepCount: 7,
      });

      expect(update.stepCount).toBe(1);
    });

    it("increments stepCount when last message is a ToolMessage (loop continuation)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        stepCount: 3,
      });

      expect(update.stepCount).toBe(4);
    });

    it("starts stepCount at 1 from zero on first loop continuation", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        stepCount: 0,
      });

      expect(update.stepCount).toBe(1);
    });
  });

  describe("tool output truncation", () => {
    it("truncates exec_sql output exceeding 8000 chars and appends a notice", async () => {
      const largeRows = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `expense-${i}`,
        paid_date: "2026-01-01",
      }));
      const largeJson = JSON.stringify(largeRows);

      const session: SupabaseMcpSession = {
        executeSql: vi.fn().mockResolvedValue(largeRows),
        close: vi.fn(),
      };
      const execSqlTool = getFinanceDomainTool(session, "exec_sql");
      const result = String(await execSqlTool?.invoke({ sql: "SELECT * FROM expenses;" }));

      expect(result.length).toBeLessThanOrEqual(8_000 + 60); // truncated + notice overhead
      expect(result).toContain("[truncated,");
      expect(result.length).toBeLessThan(largeJson.length);
    });

    it("does not truncate exec_sql output within 8000 chars", async () => {
      const session: SupabaseMcpSession = {
        executeSql: vi.fn().mockResolvedValue(categories),
        close: vi.fn(),
      };
      const execSqlTool = getFinanceDomainTool(session, "exec_sql");
      const result = String(await execSqlTool?.invoke({ sql: "SELECT * FROM category;" }));

      expect(result).not.toContain("[truncated,");
      expect(JSON.parse(result)).toEqual(categories);
    });
  });
});
