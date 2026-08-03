import { connectSupabaseMcp } from "./mcp/supabase.js";
import { createSelfHealingSqlSession } from "./mcp/self-healing-session.js";
import type { McpReconnectConfig, SupabaseConfig } from "../config.js";
import type { SqlSession } from "./mcp/sql-session.js";

export type SupabaseSessions = {
  supabaseReadSession?: SqlSession;
  supabaseWriteSession?: SqlSession;
};

export type SupabaseSessionConfig = SupabaseConfig & McpReconnectConfig;

/** Present credentials after setupSupabaseSessions presence checks. */
type CredentialedSupabaseSessionConfig = {
  supabaseMcpUrl: string;
  supabaseProjectRef: string;
  supabaseAccessToken: string;
} & McpReconnectConfig;

const connectSupabaseSession = async (
  config: CredentialedSupabaseSessionConfig,
  readOnly: boolean,
): Promise<SqlSession> => {
  const mcpConfig = {
    url: config.supabaseMcpUrl,
    projectRef: config.supabaseProjectRef,
    accessToken: config.supabaseAccessToken,
    readOnly,
  };

  return createSelfHealingSqlSession({
    connect: () => connectSupabaseMcp(mcpConfig),
    maxReconnectAttempts: config.mcpMaxReconnectAttempts,
    reconnectBackoff: {
      baseDelayMs: config.mcpReconnectBaseDelayMs,
      maxDelayMs: config.mcpReconnectMaxDelayMs,
    },
    onReconnect: ({ attempt, delayMs, error }) => {
      console.warn(
        `[Finance Setup] Supabase MCP transport error (${readOnly ? "read" : "write"}, reconnect attempt ${attempt} after ${delayMs}ms), re-establishing session:`,
        error instanceof Error ? error.message : error,
      );
    },
  });
};

export const setupSupabaseSessions = async (
  config: SupabaseSessionConfig,
): Promise<SupabaseSessions> => {
  if (!config.supabaseProjectRef || !config.supabaseAccessToken || !config.supabaseMcpUrl) {
    console.log("[Finance Setup] ✗ Skipping finance sync setup - missing required configuration.");
    return {};
  }

  const credentialedConfig: CredentialedSupabaseSessionConfig = {
    supabaseMcpUrl: config.supabaseMcpUrl,
    supabaseProjectRef: config.supabaseProjectRef,
    supabaseAccessToken: config.supabaseAccessToken,
    mcpMaxReconnectAttempts: config.mcpMaxReconnectAttempts,
    mcpReconnectBaseDelayMs: config.mcpReconnectBaseDelayMs,
    mcpReconnectMaxDelayMs: config.mcpReconnectMaxDelayMs,
  };

  try {
    console.log("[Finance Setup] All credentials present, creating Supabase MCP sessions...");
    const [supabaseReadSession, supabaseWriteSession] = await Promise.all([
      connectSupabaseSession(credentialedConfig, true),
      connectSupabaseSession(credentialedConfig, false),
    ]);

    if (supabaseReadSession && supabaseWriteSession) {
      console.log("[Finance Setup] ✓ Supabase MCP read/write sessions created successfully.");
    }

    return {
      ...(supabaseReadSession ? { supabaseReadSession } : {}),
      ...(supabaseWriteSession ? { supabaseWriteSession } : {}),
    };
  } catch (error) {
    console.error("[Finance Setup] ✗ Failed to create Supabase sessions:", error);
    return {};
  }
};
