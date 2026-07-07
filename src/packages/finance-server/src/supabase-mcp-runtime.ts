import type { FinanceRepository } from "../../../nodes/finance-node/src/index.js";
import type { WiseTransaction } from "../../../nodes/finance-node/src/wise-client.js";
import { fetchWiseTransactions } from "../../../nodes/finance-node/src/wise-client.js";
import { connectSupabaseMcp, type SupabaseMcpConfig } from "./supabase-mcp-client.js";

/**
 * Safely escape a string value for inline SQL.
 * This is a basic escaping strategy for PostgreSQL string literals.
 * 
 * WARNING: The official Supabase MCP `execute_sql` does NOT support parameterized
 * queries. We must inline values safely. This function escapes single quotes and
 * wraps the value in single quotes for use in SQL WHERE/VALUES clauses.
 * 
 * For production, consider:
 * - Using a proper SQL builder library with escaping
 * - Requesting parameterized query support from the official MCP server
 * - Running queries through a stored procedure that accepts params
 */
function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Safely escape a number for inline SQL.
 */
function escapeSqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number for SQL: ${value}`);
  }
  return String(value);
}

/**
 * Bootstrap the finance runtime using the official hosted Supabase MCP server.
 * 
 * This replaces the custom in-memory finance-server with a connection to
 * https://mcp.supabase.com/mcp, calling generic `execute_sql` and implementing
 * finance-specific logic (cursor query, deduplication, batch insert) directly
 * in the repository.
 */
export async function bootstrapFinanceRuntimeWithOfficialMcp(
  config: SupabaseMcpConfig
): Promise<FinanceRepository> {
  const session = await connectSupabaseMcp(config);

  const repository: FinanceRepository = {
    async getLastPaidDate(): Promise<string> {
      const sql = "SELECT paid_date FROM public.expense ORDER BY paid_date DESC LIMIT 1";
      const result = await session.executeSql(sql) as { rows?: Array<{ paid_date: string }> };

      if (result.rows && result.rows.length > 0) {
        return result.rows[0]!.paid_date;
      }

      // Fallback: 30 days ago
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - 30);
      return fallback.toISOString().slice(0, 10);
    },

    async fetchTransactions(since: string, until: string): Promise<WiseTransaction[]> {
      // Wise is now called directly (no MCP wrapper)
      return fetchWiseTransactions({ since, until });
    },

    async insertTransactions(transactions: WiseTransaction[]): Promise<{ inserted: number; skipped: number }> {
      let inserted = 0;
      let skipped = 0;

      // Deduplicate within the batch by (title, date)
      const seen = new Set<string>();
      const deduped = transactions.filter((t) => {
        const key = `${t.title}__${t.date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const transaction of deduped) {
        // Check for existing record (dedup against DB)
        const checkSql = `SELECT * FROM public.expense WHERE name = ${escapeSqlString(transaction.title)} AND paid_date = ${escapeSqlString(transaction.date)} LIMIT 1`;
        const checkResult = await session.executeSql(checkSql) as { rows?: unknown[] };

        if (checkResult.rows && checkResult.rows.length > 0) {
          skipped++;
          continue;
        }

        // Insert the transaction
        const amount = transaction.amount !== undefined ? escapeSqlNumber(transaction.amount) : "NULL";
        const category = transaction.category !== undefined ? escapeSqlString(transaction.category) : "NULL";
        const paid = transaction.paid !== undefined ? String(transaction.paid) : "NULL";
        const note = transaction.note !== undefined ? escapeSqlString(transaction.note) : "NULL";

        const insertSql = `
          INSERT INTO public.expense (name, amount, category, paid_date, paid, note)
          VALUES (
            ${escapeSqlString(transaction.title)},
            ${amount},
            ${category},
            ${escapeSqlString(transaction.date)},
            ${paid},
            ${note}
          )
        `;

        await session.executeSql(insertSql);
        inserted++;
      }

      return { inserted, skipped };
    },
  };

  return repository;
}
