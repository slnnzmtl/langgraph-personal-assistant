import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { parseExecuteSqlResponse } from "./response-parser.js";

export interface SupabaseMcpConfig {
  url: string;
  projectRef: string;
  accessToken: string;
  readOnly?: boolean;
}

export interface SupabaseMcpSession {

  executeSql<T = unknown>(sql: string): Promise<T>;
  close(): Promise<void>;
}

function buildSupabaseMcpUrl(config: SupabaseMcpConfig): URL {
  const url = new URL(config.url);
  url.searchParams.set("project_ref", config.projectRef);
  if (config.readOnly) {
    url.searchParams.set("read_only", "true");
  }
  url.searchParams.set("features", "database");
  return url;
}

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
