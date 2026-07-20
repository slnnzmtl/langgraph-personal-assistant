import type { AppConfig } from "../config.js";
import { connectSupabaseMcp, type SupabaseMcpSession } from "../mcp/supabase.js";
import { createSelfHealingMcpSession } from "../mcp/self-healing-session.js";

export const setupSupabaseSession = async (
  config: AppConfig
): Promise<SupabaseMcpSession | undefined> => {
  if (config.supabaseProjectRef && config.supabaseAccessToken) {
    try {
      console.log("[Finance Setup] All credentials present, creating Supabase MCP session...");
      const mcpConfig = {
        url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
        projectRef: config.supabaseProjectRef,
        accessToken: config.supabaseAccessToken,
        readOnly: false as const,
      };

      const session = await createSelfHealingMcpSession({
        connect: () => connectSupabaseMcp(mcpConfig),
        maxReconnectAttempts: config.mcpMaxReconnectAttempts,
        reconnectBackoff: {
          baseDelayMs: config.mcpReconnectBaseDelayMs,
          maxDelayMs: config.mcpReconnectMaxDelayMs,
        },
        onReconnect: ({ attempt, delayMs, error }) => {
          console.warn(
            `[Finance Setup] Supabase MCP transport error (reconnect attempt ${attempt} after ${delayMs}ms), re-establishing session:`,
            error instanceof Error ? error.message : error,
          );
        },
      });

      console.log("[Finance Setup] ✓ Supabase MCP session created successfully.");
      return session;
    } catch (error) {
      console.error("[Finance Setup] ✗ Failed to create Supabase session:", error);
      return undefined;
    }
  } else {
    console.log("[Finance Setup] ✗ Skipping finance sync setup - missing required configuration.");
    return undefined;
  }
};

