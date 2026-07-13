import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { parseExecuteSqlResponse } from "./response-parser.js";

/**
 * Scaffolding for connecting to the official hosted Supabase MCP server.
 *
 * Reference: https://github.com/supabase/mcp
 *
 * This module replaces the custom, hand-rolled Supabase MCP tools
 * (`supabase_get_last_paid_date`, `supabase_insert_transaction`) with the
 * official server's generic database tools (notably `execute_sql`).
 *
 * SCOPE (this pass): connection + client bootstrap only.
 * The finance-specific SQL (cursor query + insert-with-dedup) is intentionally
 * NOT migrated here yet. That logic will move into finance-node's
 * `FinanceRepository`, which will call `executeSql(...)` from this module in a
 * follow-up pass. See /memories/session/plan.md.
 */

export interface SupabaseMcpConfig {
  /** Base URL of the hosted Supabase MCP server, e.g. https://mcp.supabase.com/mcp */
  url: string;
  /** Project reference used to scope the server to a single project. */
  projectRef: string;
  /**
   * Personal access token (or OAuth access token) sent as a Bearer credential.
   * For the hosted server this authorizes the MCP session.
   */
  accessToken: string;
  /**
   * When true, restricts the server to read-only queries and disables mutating
   * tools. Finance sync requires INSERT, so this defaults to false.
   */
  readOnly?: boolean;
}

/**
 * A minimal handle over an active Supabase MCP session.
 * `executeSql` is the single boundary the finance repository will depend on.
 */
export interface SupabaseMcpSession {
  /**
   * Execute raw SQL via the official `execute_sql` tool and return the parsed
   * rows. Parameter binding semantics will be finalized during logic migration.
   */
  executeSql<T = unknown>(sql: string): Promise<T>;
  /** Close the underlying transport/session. */
  close(): Promise<void>;
}

/**
 * Build the scoped server URL, appending project scoping and read-only mode as
 * query parameters per the official server's option contract.
 */
export function buildSupabaseMcpUrl(config: SupabaseMcpConfig): URL {
  const url = new URL(config.url);
  url.searchParams.set("project_ref", config.projectRef);
  if (config.readOnly) {
    url.searchParams.set("read_only", "true");
  }
  // Finance only needs the database tool group; keep the surface minimal.
  url.searchParams.set("features", "database");
  return url;
}

/**
 * Connect to the hosted Supabase MCP server and return a session handle.
 *
 * NOTE: The hosted server uses OAuth 2.1. For a headless backend we pass an
 * access token as a Bearer header. Interactive OAuth flows are out of scope for
 * this scaffolding and can be layered in via an SDK auth provider later.
 */
export async function connectSupabaseMcp(config: SupabaseMcpConfig): Promise<SupabaseMcpSession> {
  const url = buildSupabaseMcpUrl(config);

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    },
  });

  const client = new Client(
    { name: "finance-supabase-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport as Transport);

  const executeSql = async <T = unknown>(sql: string): Promise<T> => {
    const response = await client.callTool({
      name: "execute_sql",
      arguments: { query: sql },
    });

    return parseExecuteSqlResponse(response) as T;
  };

  const close = async (): Promise<void> => {
    await client.close();
  };

  return { executeSql, close };
}
