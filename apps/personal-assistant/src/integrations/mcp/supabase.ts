import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { normalizeToolOutput } from "../../utils/exec-sql.js";

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

type TextContent = {
  type: string;
  text?: string;
};

export function formatRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}: null`;
      if (typeof value === "string") return `${key}: '${value}'`;
      return `${key}: ${value}`;
    })
    .join(", ");
}

export function parseExecuteSqlResponse(response: unknown): unknown {
  const content = (response as { content?: TextContent[] }).content;
  const text = content?.find((item) => item.type === "text")?.text;

  if (!text) {
    throw new Error("Unexpected response format from execute_sql tool");
  }

  return normalizeToolOutput(text);
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
