import { connectSupabaseMcp, type SupabaseMcpConfig } from "./mcp/supabase.js";
import { createSelfHealingMcpSession } from "./mcp/self-healing-session.js";
import type { AppConfig } from "../config.js";
import type { SqlSession } from "../ports/sql-session.js";

export type SupabaseSessions = {
  supabaseReadSession?: SqlSession;
  supabaseWriteSession?: SqlSession;
};

const connectSupabaseSession = async (
  config: AppConfig,
  readOnly: boolean,
): Promise<SqlSession | undefined> => {
  if (!config.supabaseProjectRef || !config.supabaseAccessToken) {
    return undefined;
  }

  const mcpConfig: SupabaseMcpConfig = {
    url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
    projectRef: config.supabaseProjectRef,
    accessToken: config.supabaseAccessToken,
    readOnly,
  };

  return createSelfHealingMcpSession({
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

export const setupSupabaseSessions = async (config: AppConfig): Promise<SupabaseSessions> => {
  if (!config.supabaseProjectRef || !config.supabaseAccessToken) {
    console.log("[Finance Setup] ✗ Skipping finance sync setup - missing required configuration.");
    return {};
  }

  try {
    console.log("[Finance Setup] All credentials present, creating Supabase MCP sessions...");
    const [supabaseReadSession, supabaseWriteSession] = await Promise.all([
      connectSupabaseSession(config, true),
      connectSupabaseSession(config, false),
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
