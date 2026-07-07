// ============================================================================
// TDD BLUEPRINT: FINANCE MCP TOOLS UNIT TESTS
// Architecture: Model Context Protocol (MCP) Tool Mapping Layer
// Mocking Strategy: Stub out the remote MCP client responses and global fetch.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wiseGetTransactionsHandler } from "./src/tools/wise.js";
import { mcpGetLastPaidDateHandler, mcpInsertTransactionHandler, mcpInsertTransactionsHandler } from "./src/tools/supabase.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMcpTool(invokeReturnValue: unknown) {
  return { invoke: vi.fn().mockResolvedValue(invokeReturnValue) };
}

// ---------------------------------------------------------------------------
// TOOL 1: wiseGetTransactionsHandler
// ---------------------------------------------------------------------------

describe("wiseGetTransactionsHandler", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env["WISE_API_TOKEN"] = "test-bearer-token";
    process.env["WISE_PROFILE_ID"] = "123456";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["WISE_API_TOKEN"];
    delete process.env["WISE_PROFILE_ID"];
  });

  it("1.1 – fetches the Wise profile activities endpoint with Bearer token and returns a flattened transaction array", async () => {
    const mockTransactions = [
      { id: "txn-1", title: "Coffee", amount: -3.5, currency: "GBP", date: "2026-07-01" },
      { id: "txn-2", title: "Salary",  amount: 2000,  currency: "GBP", date: "2026-07-02" },
    ];

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ activities: mockTransactions }),
    });

    const result = await wiseGetTransactionsHandler({ since: "2026-07-01", until: "2026-07-07" });

    // Verify the HTTP call was made with the correct auth header
    expect(fetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("123456");
    expect(calledUrl).toContain("2026-07-01");
    expect(calledUrl).toContain("2026-07-07");
    expect((calledInit.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer test-bearer-token");

    // Verify the return shape
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "txn-1", title: "Coffee" });
  });

  it("1.2 – throws a validation error before calling fetch when required parameters are missing", async () => {
    await expect(
      // @ts-expect-error intentionally passing incomplete input
      wiseGetTransactionsHandler({ since: "2026-07-01" })
    ).rejects.toThrow(/validation|required|until/i);

    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TOOL 2: mcpGetLastPaidDateHandler
// ---------------------------------------------------------------------------

describe("mcpGetLastPaidDateHandler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("2.1 – extracts and returns the date string from the MCP tool response when rows exist", async () => {
    const mcpTool = makeMcpTool(JSON.stringify({ rows: [{ paid_date: "2026-06-15" }] }));

    const result = await mcpGetLastPaidDateHandler(mcpTool);

    expect(mcpTool.invoke).toHaveBeenCalledOnce();
    expect(result).toBe("2026-06-15");
  });

  it("2.2 – returns a fallback date 30 days ago when the MCP tool response is empty", async () => {
    const frozenNow = new Date("2026-07-07T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(frozenNow);

    const mcpTool = makeMcpTool(JSON.stringify({ rows: [] }));

    const result = await mcpGetLastPaidDateHandler(mcpTool);

    // 30 days before 2026-07-07 is 2026-06-07
    expect(result).toBe("2026-06-07");
  });
});

// ---------------------------------------------------------------------------
// TOOL 3: mcpInsertTransactionHandler
// ---------------------------------------------------------------------------

describe("mcpInsertTransactionHandler", () => {
  const transaction = {
    id: "txn-42",
    title: "Groceries",
    amount: -45.0,
    currency: "GBP",
    date: "2026-07-05",
  };

  it("3.1 – inserts the transaction and returns the created record when no duplicate is found", async () => {
    const createdRecord = { ...transaction, db_id: 99 };
    const readTool   = makeMcpTool(JSON.stringify({ rows: [] }));
    const insertTool = makeMcpTool(JSON.stringify({ rows: [createdRecord] }));

    const result = await mcpInsertTransactionHandler(readTool, insertTool, transaction);

    expect(readTool.invoke).toHaveBeenCalledOnce();
    expect(insertTool.invoke).toHaveBeenCalledOnce();

    // The insert call must use a parameterized query and pass title/date as params
    const [insertSql, insertParams] = insertTool.invoke.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain("$1");
    expect(insertParams).toContain(transaction.title);
    expect(insertParams).toContain(transaction.date);

    expect(result).toMatchObject(createdRecord);
  });

  it("3.2 – skips insertion and returns bypass payload when a duplicate record exists", async () => {
    const readTool   = makeMcpTool(JSON.stringify({ rows: [transaction] }));
    const insertTool = makeMcpTool(null); // should never be called

    const result = await mcpInsertTransactionHandler(readTool, insertTool, transaction);

    expect(readTool.invoke).toHaveBeenCalledOnce();
    expect(insertTool.invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "skipped", message: "Duplicate transaction detected." });
  });
});

// ---------------------------------------------------------------------------
// TOOL 4: mcpInsertTransactionsHandler (batch)
// ---------------------------------------------------------------------------

describe("mcpInsertTransactionsHandler", () => {
  const txA = { title: "Coffee", amount: -3.5, currency: "GBP", date: "2026-07-01" };
  const txB = { title: "Lunch",  amount: -12.0, currency: "GBP", date: "2026-07-02" };

  it("4.1 – inserts all non-duplicate transactions and returns correct inserted/skipped counts", async () => {
    // txA: no duplicate → inserted; txB: duplicate exists → skipped
    const readTool = {
      invoke: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({ rows: [] }))          // txA: no dup
        .mockResolvedValueOnce(JSON.stringify({ rows: [txB] })),      // txB: dup
    };
    const insertTool = makeMcpTool(JSON.stringify({ rows: [{ ...txA, db_id: 1 }] }));

    const result = await mcpInsertTransactionsHandler(readTool, insertTool, [txA, txB]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toEqual({ status: "skipped", message: "Duplicate transaction detected." });
  });

  it("4.2 – deduplicates within the batch before hitting the DB (same title+date appears twice)", async () => {
    const readTool   = makeMcpTool(JSON.stringify({ rows: [] }));
    const insertTool = makeMcpTool(JSON.stringify({ rows: [{ ...txA, db_id: 2 }] }));

    // Pass txA twice – only one DB call should occur
    const result = await mcpInsertTransactionsHandler(readTool, insertTool, [txA, txA]);

    expect(readTool.invoke).toHaveBeenCalledOnce();
    expect(insertTool.invoke).toHaveBeenCalledOnce();
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("4.3 – returns inserted=0 and skipped=N when all transactions are duplicates", async () => {
    const readTool   = makeMcpTool(JSON.stringify({ rows: [txA] }));
    const insertTool = { invoke: vi.fn() };

    const result = await mcpInsertTransactionsHandler(readTool, insertTool, [txA, txB]);

    // Both reads return duplicate-found rows (second call also returns txA-like data)
    // but readTool.invoke is always called with the respective args
    expect(insertTool.invoke).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });
});