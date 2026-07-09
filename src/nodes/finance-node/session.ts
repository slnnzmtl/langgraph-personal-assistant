import type { AppConfig } from "../../config.js";
import { bootstrapFinanceRuntimeWithOfficialMcp } from "../../mcp/supabase/index.js";
import type { SupabaseMcpSession } from "../../mcp/supabase/index.js";

/**
 * Create a Supabase MCP session for finance operations based on the app config.
 * Returns `undefined` when the configuration is missing or the connection fails.
 */
export const setupFinanceDatabaseSession = async (
  config: AppConfig
): Promise<SupabaseMcpSession | undefined> => {
  if (config.enableFinanceSync && config.supabaseProjectRef && config.supabaseAccessToken) {
    try {
      console.log("[Finance Setup] All credentials present, creating Supabase MCP session...");
      const session = await bootstrapFinanceRuntimeWithOfficialMcp({
        url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
        projectRef: config.supabaseProjectRef,
        accessToken: config.supabaseAccessToken,
        // Finance sync needs write access for INSERT
        readOnly: false,
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

export default setupFinanceDatabaseSession;
