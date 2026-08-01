import type { PersistenceConfig } from "../config.js";
import type { SupabaseSessionConfig } from "../integrations/supabase.js";
import { MemorySaver } from "@langchain/langgraph";
import type { SqlSession } from "../integrations/mcp/sql-session.js";
import { setupSupabaseSessions } from "../integrations/supabase.js";
import { openDurabilityStore, type DurabilityStore } from "../persistence/durability-store.js";

/**
 * Process-lifecycle resources opened once at bootstrap and closed on shutdown/recompile.
 * Product clients (Obsidian vault, Wise fetch) are closed over in personal-pack
 * buildCapabilityProviders after setupAdapters — they have no close/reconnect lifecycle here.
 */
export type PersonalAdapters = {
  supabaseReadSession?: SqlSession;
  supabaseWriteSession?: SqlSession;
  durabilityStore?: DurabilityStore;
};

export type PersonalAdapterConfig = SupabaseSessionConfig & PersistenceConfig;

export const setupPersonalAdapters = async (
  appConfig: PersonalAdapterConfig,
): Promise<PersonalAdapters> => {
  const sessions = await setupSupabaseSessions(appConfig);
  return {
    ...(sessions.supabaseReadSession ? { supabaseReadSession: sessions.supabaseReadSession } : {}),
    ...(sessions.supabaseWriteSession
      ? { supabaseWriteSession: sessions.supabaseWriteSession }
      : {}),
    ...(appConfig.persistenceEnabled ? { durabilityStore: openDurabilityStore(appConfig) } : {}),
  };
};

export const createPersonalCheckpointer = async (context: {
  config: PersistenceConfig;
  adapters: PersonalAdapters;
}) => {
  if (!context.config.persistenceEnabled) {
    return new MemorySaver();
  }

  const store = context.adapters.durabilityStore;
  if (!store) {
    throw new Error("Persistence is enabled but durabilityStore adapter is missing.");
  }

  return store.getCheckpointer();
};

const closeSupabaseSessions = async (adapters: PersonalAdapters): Promise<void> => {
  await Promise.all([
    adapters.supabaseReadSession?.close?.().catch(() => undefined),
    adapters.supabaseWriteSession?.close?.().catch(() => undefined),
  ]);
};

export const closePersonalAdapters = async (adapters: PersonalAdapters): Promise<void> => {
  await closeSupabaseSessions(adapters);
  adapters.durabilityStore?.close();
};
