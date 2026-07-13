import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../src/mcp/supabase/index.js";
import { createFinanceNode, createFinanceTools, findLatestExpenseContinuation } from "../../src/nodes/finance-node/node.js";
import { FINANCE_MAX_STEPS } from "../../src/nodes/finance-node/index.js";
import { FakeLLMConnector } from "../helpers/fakes.js";

const wiseTransactions = [
  {
    name: "Mpos Kokojimart",
    amount: "0.47 USD",
    status: "COMPLETED",
    createdOn: "2026-07-12T16:31:37.354Z",
  },
  {
    name: "Mpos Poke Sake Wow",
    amount: "9.19 USD",
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
    const fetchWiseTool = createFinanceTools(session).find((tool) => tool.name === "fetch_wise_transactions");

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
    const execSqlTool = createFinanceTools(session).find((tool) => tool.name === "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT id, name, note FROM public.category;" });

    expect(JSON.parse(String(result))).toEqual(categories);
  });

  it("serializes tool failures as structured error text", async () => {
    const session: SupabaseMcpSession = {
      executeSql: vi.fn().mockRejectedValue(new Error("database unavailable")),
      close: vi.fn(),
    };
    const execSqlTool = createFinanceTools(session).find((tool) => tool.name === "exec_sql");

    const result = await execSqlTool?.invoke({ sql: "SELECT 1;" });

    expect(JSON.parse(String(result))).toEqual({ error: "database unavailable" });
  });

  it("uses the latest identifiable expense query as continuation context", async () => {
    const expenses = [
      { id: 1533, name: "Vnpay Divinecrepes", amount: 5, paid_date: "2026-07-12", category: 4 },
      { id: 1534, name: "Mpos Poke Sake Wow", amount: 9, paid_date: "2026-07-12", category: 33 },
    ];
    const model = new FakeLLMConnector((messages) => {
      expect(messages[0].content).toContain("<latest_expense_selection>");
      expect(messages[0].content).toContain(JSON.stringify(expenses));
      expect(messages.at(-1)?.content).toBe("define a category for each expense");
      return new AIMessage("I will categorize the selected expenses.");
    }).getModel();
    const financeNode = createFinanceNode(model, []);
    const messages = [
      new HumanMessage("for yesterday"),
      new ToolMessage({ tool_call_id: "expenses-query", name: "exec_sql", content: JSON.stringify(expenses) }),
      new AIMessage("Here are the expenses from yesterday."),
      new HumanMessage("define a category for each expense"),
    ];

    expect(findLatestExpenseContinuation(messages)).toEqual(expenses);

    const update = await financeNode({ messages, financeStepCount: 0, financeExpenseSelection: [] });

    expect(update.messages).toEqual([expect.objectContaining({ content: "I will categorize the selected expenses." })]);
    expect(update.financeExpenseSelection).toEqual(expenses);
  });

  it("does not treat category rows as an expense selection", () => {
    const expenses = [{ id: 1533, name: "Vnpay Divinecrepes", amount: 5, paid_date: "2026-07-12" }];
    // categories have id+name but no paid_date — shape check excludes them
    const messages = [
      new ToolMessage({ tool_call_id: "expenses-query", name: "exec_sql", content: JSON.stringify(expenses) }),
      new ToolMessage({ tool_call_id: "categories-query", name: "exec_sql", content: JSON.stringify(categories) }),
    ];

    expect(findLatestExpenseContinuation(messages)).toEqual(expenses);
  });

  it("uses the persisted expense selection after history trimming", async () => {
    const expenses = [{ id: 1533, name: "Vnpay Divinecrepes", amount: 5, paid_date: "2026-07-12" }];
    const model = new FakeLLMConnector((messages) => {
      expect(messages[0].content).toContain(JSON.stringify(expenses));
      return new AIMessage("I will update the selected expense.");
    }).getModel();
    const financeNode = createFinanceNode(model, []);

    const update = await financeNode({
      messages: [new HumanMessage("change their categories")],
      financeStepCount: 0,
      financeExpenseSelection: expenses,
    });

    expect(update.financeExpenseSelection).toEqual(expenses);
  });

  describe("step counter", () => {
    it("resets financeStepCount to 1 on initial entry (last message is HumanMessage)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [new HumanMessage("sync finances")],
        financeStepCount: 7,
        financeExpenseSelection: [],
      });

      expect(update.financeStepCount).toBe(1);
    });

    it("increments financeStepCount when last message is a ToolMessage (loop continuation)", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        financeStepCount: 3,
        financeExpenseSelection: [],
      });

      expect(update.financeStepCount).toBe(4);
    });

    it("starts financeStepCount at 1 from zero on first loop continuation", async () => {
      const model = new FakeLLMConnector(() => new AIMessage("done")).getModel();
      const financeNode = createFinanceNode(model, []);

      const update = await financeNode({
        messages: [
          new HumanMessage("sync finances"),
          new ToolMessage({ tool_call_id: "t1", name: "exec_sql", content: "[]" }),
        ],
        financeStepCount: 0,
        financeExpenseSelection: [],
      });

      expect(update.financeStepCount).toBe(1);
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
      const execSqlTool = createFinanceTools(session).find((t) => t.name === "exec_sql");
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
      const execSqlTool = createFinanceTools(session).find((t) => t.name === "exec_sql");
      const result = String(await execSqlTool?.invoke({ sql: "SELECT * FROM category;" }));

      expect(result).not.toContain("[truncated,");
      expect(JSON.parse(result)).toEqual(categories);
    });
  });
});
