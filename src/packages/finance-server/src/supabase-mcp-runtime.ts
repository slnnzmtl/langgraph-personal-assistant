import { connectSupabaseMcp, type SupabaseMcpConfig, type SupabaseMcpSession } from "./supabase-mcp-client.js";

/**
 * Bootstrap connection to official hosted Supabase MCP server.
 * Agents call executeSql() directly for maximum flexibility.
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
): Promise<SupabaseMcpSession> {
  return connectSupabaseMcp(config);
}

// Alias for clarity
export const connectSupabaseMcpSession = bootstrapFinanceRuntimeWithOfficialMcp;
