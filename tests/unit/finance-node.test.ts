import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupabaseMcpSession } from "../../src/mcp/supabase/index.js";
import { createFinanceTools } from "../../src/nodes/finance-node/agent.js";

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
});
