// ============================================================================
// TDD SPEC: Finance Sync Graph with FinanceRepository
// Architecture: LangGraph Sync Pipeline (Repository Interface)
// Testing Target: Vitest unit suite
// Strategy: Mock the FinanceRepository interface to test orchestration logic
// ============================================================================

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { WiseTransaction } from "./wise-client.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CURSOR_DATE = "2026-07-01";
const FROZEN_TODAY = "2026-07-07";

const STUB_TRANSACTIONS: WiseTransaction[] = [
  { id: "txn-1", title: "Coffee",  amount: -3.5,  currency: "GBP", date: "2026-07-02" },
  { id: "txn-2", title: "Salary",  amount: 2000,  currency: "GBP", date: "2026-07-05" },
];

// ---------------------------------------------------------------------------
// Repository-Based Interface Tests
// ---------------------------------------------------------------------------

describe("buildFinanceSyncGraph with FinanceRepository interface", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TODAY));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("1.1 – given a finance repository, builds and executes sync pipeline with getLastPaidDate → fetchTransactions → insertTransactions", async () => {
    interface FinanceRepository {
      getLastPaidDate(): Promise<string>;
      fetchTransactions(since: string, until: string): Promise<WiseTransaction[]>;
      insertTransactions(transactions: WiseTransaction[]): Promise<{ inserted: number; skipped: number }>;
    }

    const mockRepository: FinanceRepository = {
      getLastPaidDate: vi.fn().mockResolvedValue(CURSOR_DATE),
      fetchTransactions: vi.fn().mockResolvedValue(STUB_TRANSACTIONS),
      insertTransactions: vi.fn().mockResolvedValue({ inserted: 2, skipped: 0 }),
    };

    const { buildFinanceSyncGraph } = await import("./agent.js");
    const graph = buildFinanceSyncGraph(mockRepository);

    const result = await graph.invoke({}, { configurable: { thread_id: "finance-sync-repo-test" } });

    // 1. getLastPaidDate must be called exactly once
    expect(mockRepository.getLastPaidDate).toHaveBeenCalledOnce();

    // 2. fetchTransactions called with date range (note: dates are normalized to ISO format)
    expect(mockRepository.fetchTransactions).toHaveBeenCalledAfter(mockRepository.getLastPaidDate as any);
    expect(mockRepository.fetchTransactions).toHaveBeenCalledWith(
      `${CURSOR_DATE}T00:00:00.000Z`,
      new Date(FROZEN_TODAY).toISOString()
    );

    // 3. insertTransactions called with fetched transactions
    expect(mockRepository.insertTransactions).toHaveBeenCalledAfter(mockRepository.fetchTransactions as any);
    expect(mockRepository.insertTransactions).toHaveBeenCalledWith(STUB_TRANSACTIONS);

    // 4. Verify execution order
    expect(mockRepository.getLastPaidDate).toHaveBeenCalledBefore(mockRepository.fetchTransactions as any);
    expect(mockRepository.fetchTransactions).toHaveBeenCalledBefore(mockRepository.insertTransactions as any);

    // 5. Final metrics
    expect(result.metrics).toEqual({ processed: 2, skipped: 0 });
  });
});
