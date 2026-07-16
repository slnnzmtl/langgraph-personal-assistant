import type { AppConfig } from "../config.js";
import { connectSupabaseMcp, SupabaseMcpSession } from "../mcp/supabase.js";

export const setupSupabaseSession = async (
  config: AppConfig
): Promise<SupabaseMcpSession | undefined> => {
  if (config.supabaseProjectRef && config.supabaseAccessToken) {
    try {
      console.log("[Finance Setup] All credentials present, creating Supabase MCP session...");
      const session = await connectSupabaseMcp({
        url: config.supabaseMcpUrl ?? "https://mcp.supabase.com/mcp",
        projectRef: config.supabaseProjectRef,
        accessToken: config.supabaseAccessToken,
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

