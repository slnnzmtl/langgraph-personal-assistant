import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { mcpGetLastPaidDateHandler, mcpInsertTransactionsHandler } from "../../../packages/finance-server/src/tools/supabase.js";
import { wiseGetTransactionsHandler } from "../../../packages/finance-server/src/tools/wise.js";
import type { Transaction as WiseTransaction } from "../../../packages/finance-server/src/tools/wise.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SyncMetrics {
  processed: number;
  skipped: number;
  status: "success" | "failed";
}

export interface FinanceRepository {
  getLastPaidDate(): Promise<string>;
  fetchTransactions(since: string, until: string): Promise<WiseTransaction[]>;
  insertTransactions(transactions: WiseTransaction[]): Promise<{ inserted: number; skipped: number }>;
}

export interface McpTool {
  invoke(query: string, params?: unknown[]): Promise<string>;
}

export interface FinancePipelineDeps {
  dbReadTool: McpTool;
  dbWriteTool: McpTool;
}

export interface SyncError {
  type: "network" | "validation" | "database";
  message: string;
}

function classifyError(e: unknown): SyncError {
  const message = e instanceof Error ? e.message : String(e);
  if (/5\d{2}|timeout|unavailable|ECONNREFUSED/i.test(message)) {
    return { type: "network", message };
  }
  if (/valid|schema|required|invalid/i.test(message)) {
    return { type: "validation", message };
  }
  return { type: "database", message };
}

// ---------------------------------------------------------------------------
// Graph state
// ---------------------------------------------------------------------------

export const SyncStateAnnotation = Annotation.Root({
  cursorDate: Annotation<string | undefined>({
    reducer: (_, b) => b,
  }),
  syncUntil: Annotation<string | undefined>({
    reducer: (_, b) => b,
  }),
  transactions: Annotation<WiseTransaction[] | undefined>({
    reducer: (_, b) => b,
  }),
  metrics: Annotation<{ processed: number; skipped: number }>({
    default: () => ({ processed: 0, skipped: 0 }),
    reducer: (_, b) => b,
  }),
  error: Annotation<SyncError | undefined>({
    default: () => undefined,
    reducer: (_, b) => b,
  }),
});

type SyncState = typeof SyncStateAnnotation.State;

// ---------------------------------------------------------------------------
// Graph factory (closes over injected FinanceRepository)
// ---------------------------------------------------------------------------

export function buildFinanceSyncGraph(repository: FinanceRepository) {
  // Wrap repository methods with @tool decorator for LangSmith observability
  const getCursorDate = tool(
    async () => repository.getLastPaidDate(),
    {
      name: "get_cursor_date",
      description: "Retrieve the last paid date from Supabase to establish sync boundary",
      schema: z.object({}),
    }
  );

  const fetchWiseTransactions = tool(
    async (input: { since: string; until: string }) =>
      repository.fetchTransactions(input.since, input.until),
    {
      name: "fetch_wise_transactions",
      description: "Fetch new transactions from Wise API within a date range",
      schema: z.object({
        since: z.string().describe("Start date for transaction query"),
        until: z.string().describe("End date for transaction query"),
      }),
    }
  );

  const batchInsertTransactions = tool(
    async (input: { transactions: WiseTransaction[] }) =>
      repository.insertTransactions(input.transactions),
    {
      name: "batch_insert_transactions",
      description: "Batch insert transactions into Supabase with deduplication",
      schema: z.object({
        transactions: z.array(z.any()).describe("Array of transactions to insert"),
      }),
    }
  );

  const fetchCursor = async (_state: SyncState) => {
    const cursorDate = await getCursorDate.invoke({});
    return { cursorDate };
  };
  
const fetchWiseData = async (state: SyncState) => {
  try {
    if (!state.cursorDate) {
      throw new Error("Validation: cursorDate not populated by fetch_cursor node");
    }

    // Ensure the baseline cursor date format is padded to full ISO if it was pulled as a plain date from SQL
    const sinceParam = state.cursorDate.includes("T") 
      ? state.cursorDate 
      : `${state.cursorDate}T00:00:00.000Z`;

    // Always keep the full ISO format for the current execution line
    const untilParam = new Date().toISOString(); 

    const transactions = await fetchWiseTransactions.invoke({ 
      since: sinceParam, 
      until: untilParam 
    });
    
    return { transactions };
  } catch (e) {
    return { error: classifyError(e) };
  }
};

  const batchProcess = async (state: SyncState) => {
    try {
      if (!state.transactions || state.transactions.length === 0) {
        return { metrics: { processed: 0, skipped: 0 }, syncUntil: new Date().toISOString() };
      }
      const result = await batchInsertTransactions.invoke({ transactions: state.transactions });
      const { inserted, skipped } = result as { inserted: number; skipped: number };
      return { metrics: { processed: inserted, skipped }, syncUntil: new Date().toISOString() };
    } catch (e) {
      return { error: classifyError(e), syncUntil: new Date().toISOString() };
    }
  };

  const errorRecovery = (state: SyncState) => {
    const err = state.error!;
    if (err.type === "network") {
      console.error("[finance-sync] Network error (consider retry):", err.message);
    } else if (err.type === "validation") {
      console.error("[finance-sync] Validation error (needs human review):", err.message);
    } else {
      console.error("[finance-sync] Database error:", err.message);
    }
    return { syncUntil: new Date().toISOString() };
  };

  return new StateGraph(SyncStateAnnotation)
    .addNode("fetch_cursor", fetchCursor)
    .addNode("fetch_wise_data", fetchWiseData)
    .addNode("batch_process", batchProcess)
    .addNode("error_recovery", errorRecovery)
    .addEdge(START, "fetch_cursor")
    .addEdge("fetch_cursor", "fetch_wise_data")
    .addConditionalEdges("fetch_wise_data", (state: SyncState) =>
      state.error ? "error_recovery" : "batch_process",
    )
    .addConditionalEdges("batch_process", (state: SyncState) =>
      state.error ? "error_recovery" : END,
    )
    .addEdge("error_recovery", END)
    .compile({ checkpointer: new MemorySaver() });
}

// ---------------------------------------------------------------------------
// Adapter: Convert McpTool interface to FinanceRepository interface
// ---------------------------------------------------------------------------

function createRepositoryFromMcpTools(readTool: McpTool, writeTool: McpTool): FinanceRepository {
  return {
    async getLastPaidDate() {
      return mcpGetLastPaidDateHandler(readTool);
    },
    async fetchTransactions(since: string, until: string) {
      return wiseGetTransactionsHandler({ since, until });
    },
    async insertTransactions(transactions: WiseTransaction[]) {
      const result = await mcpInsertTransactionsHandler(readTool, writeTool, transactions);
      return result as { inserted: number; skipped: number };
    },
  };
}

// ---------------------------------------------------------------------------
// Public handler — preserves the original SyncMetrics return contract
// ---------------------------------------------------------------------------

const NO_OP_TOOL: McpTool = {
  invoke: async () => JSON.stringify({ rows: [] }),
};

export async function financeSyncPipelineHandler(deps?: FinancePipelineDeps): Promise<SyncMetrics> {
  const readTool = deps?.dbReadTool  ?? NO_OP_TOOL;
  const writeTool = deps?.dbWriteTool ?? NO_OP_TOOL;

  const repository = createRepositoryFromMcpTools(readTool, writeTool);
  const graph = buildFinanceSyncGraph(repository);
  const result = await graph.invoke({}, { configurable: { thread_id: "finance-sync" } });

  if (result.error) {
    throw new Error((result.error as SyncError).message);
  }

  return { processed: result.metrics.processed, skipped: result.metrics.skipped, status: "success" };
}

export function createFinanceSyncGraph(readTool: McpTool, writeTool: McpTool) {
  const repository = createRepositoryFromMcpTools(readTool, writeTool);
  return buildFinanceSyncGraph(repository);
}