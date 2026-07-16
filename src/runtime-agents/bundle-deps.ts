import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
};
