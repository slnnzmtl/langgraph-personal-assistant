// ============================================================================
// TDD SPEC: financeSyncPipelineHandler Orchestration
// Architecture: LangGraph Sync Pipeline (MCP Tool Layer)
// Testing Target: Vitest unit suite
// Strategy: Mock all three I/O boundaries at the module level (vi.mock) so the
//           pipeline logic runs deterministically — no live DB, no live Wise API.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before the import under test
// ---------------------------------------------------------------------------

vi.mock("../../packages/finance-server/src/tools/supabase.js", () => ({
  mcpGetLastPaidDateHandler: vi.fn(),
  mcpInsertTransactionsHandler: vi.fn(),
}));

vi.mock("../../packages/finance-server/src/tools/wise.js", () => ({
  wiseGetTransactionsHandler: vi.fn(),
}));

import {
  mcpGetLastPaidDateHandler,
  mcpInsertTransactionsHandler,
} from "../../packages/finance-server/src/tools/supabase.js";
import { wiseGetTransactionsHandler } from "../../packages/finance-server/src/tools/wise.js";
import { financeSyncPipelineHandler } from "./src/agent.js";

// ---------------------------------------------------------------------------
// Typed spy references (cast once for clean usage in tests)
// ---------------------------------------------------------------------------

const mockGetLastPaidDate = mcpGetLastPaidDateHandler as ReturnType<typeof vi.fn>;
const mockWiseGetTransactions = wiseGetTransactionsHandler as ReturnType<typeof vi.fn>;
const mockBatchInsert = mcpInsertTransactionsHandler as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CURSOR_DATE = "2026-07-01";
const FROZEN_TODAY = "2026-07-07";

const STUB_TRANSACTIONS = [
  { id: "txn-1", title: "Coffee",  amount: -3.5,  currency: "GBP", date: "2026-07-02" },
  { id: "txn-2", title: "Salary",  amount: 2000,  currency: "GBP", date: "2026-07-05" },
];

// ---------------------------------------------------------------------------
// SPECIFICATION 1: financeSyncPipelineHandler Orchestration
// ---------------------------------------------------------------------------

describe("financeSyncPipelineHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TODAY));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1.1 — Standard Happy Sync Flow
  // -------------------------------------------------------------------------

  it("1.1 – given two new transactions, executes Get Cursor → Wise Delta → Batch Insert and returns { processed: 2, skipped: 0, status: 'success' }", async () => {
    mockGetLastPaidDate.mockResolvedValue(CURSOR_DATE);
    mockWiseGetTransactions.mockResolvedValue(STUB_TRANSACTIONS);
    mockBatchInsert.mockResolvedValue({ inserted: 2, skipped: 0, results: [] });

    const result = await financeSyncPipelineHandler();

    // Tool lifecycle order
    expect(mockGetLastPaidDate).toHaveBeenCalledOnce();
    expect(mockWiseGetTransactions).toHaveBeenCalledAfter(mockGetLastPaidDate);
    expect(mockBatchInsert).toHaveBeenCalledAfter(mockWiseGetTransactions);

    // Wise must receive the DB cursor as `since` and frozen today as `until`
    expect(mockWiseGetTransactions).toHaveBeenCalledWith({
      since: CURSOR_DATE,
      until: FROZEN_TODAY,
    });

    // Batch insert receives the full transaction array in a single call
    expect(mockBatchInsert).toHaveBeenCalledOnce();
    expect(mockBatchInsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      STUB_TRANSACTIONS,
    );

    // Pipeline summary
    expect(result).toEqual({ processed: 2, skipped: 0, status: "success" });
  });

  // -------------------------------------------------------------------------
  // Test 1.2 — Ledger Deduplication Boundary
  // -------------------------------------------------------------------------

  it("1.2 – given one new and one duplicate transaction, loops all rows and returns { processed: 1, skipped: 1, status: 'success' }", async () => {
    mockGetLastPaidDate.mockResolvedValue(CURSOR_DATE);
    mockWiseGetTransactions.mockResolvedValue(STUB_TRANSACTIONS);
    mockBatchInsert.mockResolvedValue({ inserted: 1, skipped: 1, results: [] });

    const result = await financeSyncPipelineHandler();

    // Batch insert is called once with the full array — dedup is the tool's responsibility
    expect(mockBatchInsert).toHaveBeenCalledOnce();

    expect(result).toEqual({ processed: 1, skipped: 1, status: "success" });
  });

  // -------------------------------------------------------------------------
  // Test 1.3 — Fail-Safe Error Fault Isolation
  // -------------------------------------------------------------------------

  it("1.3 – when wise_get_transactions throws, the error propagates and supabase_insert_transaction is never called", async () => {
    mockGetLastPaidDate.mockResolvedValue(CURSOR_DATE);
    mockWiseGetTransactions.mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(financeSyncPipelineHandler()).rejects.toThrow("503 Service Unavailable");

    // Ledger must never be written to
    expect(mockBatchInsert).not.toHaveBeenCalled();
  });
});