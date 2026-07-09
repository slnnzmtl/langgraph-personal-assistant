import { connectSupabaseMcp, type SupabaseMcpConfig, type SupabaseMcpSession } from "./supabase-mcp-client.js";

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
