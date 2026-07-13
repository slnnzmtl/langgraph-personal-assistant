import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../src/mcp/supabase/index.js";
import { createFinanceNode, createFinanceTools, findLatestExpenseContinuation } from "../../src/nodes/finance-node/agent.js";
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

    const update = await financeNode({ messages, context: {}, next: undefined });

    expect(update.messages).toEqual([expect.objectContaining({ content: "I will categorize the selected expenses." })]);
    expect(update.context).toEqual({ financeExpenseSelection: expenses });
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
      context: { financeExpenseSelection: expenses },
      next: undefined,
    });

    expect(update.context).toEqual({ financeExpenseSelection: expenses });
  });
});
