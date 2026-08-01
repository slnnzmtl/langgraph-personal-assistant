import type { ObsidianConfig, WiseConfig } from "../config.js";
import type { CapabilityProvider } from "@personal-assistant/supervisor-framework";
import { createObsidianVault } from "../integrations/obsidian.js";
import { createFetchWiseTransactions } from "../integrations/wise.js";
import {
  FINANCE_DOMAIN_CAPABILITY_ID,
  FINANCE_DOMAIN_READ_CAPABILITY_ID,
  createFinanceTools,
} from "../runtime-agents/finance/tools.js";
import {
  OBSIDIAN_VAULT_CAPABILITY_ID,
  createObsidianVaultTools,
  type SendFile,
} from "../runtime-agents/obsidian/tools.js";
import type { PersonalAdapters } from "./personal-adapters.js";

export type BuildPersonalCapabilityProvidersInput = {
  config: ObsidianConfig & WiseConfig;
  adapters: PersonalAdapters;
  sendFile?: SendFile;
};

/** Product capability providers closed over fresh adapters/config (soft-recompile safe). */
export const buildPersonalCapabilityProviders = ({
  config,
  adapters,
  sendFile,
}: BuildPersonalCapabilityProvidersInput): CapabilityProvider<Record<string, unknown>>[] => {
  const vault = config.obsidianVaultPath
    ? createObsidianVault(config.obsidianVaultPath)
    : undefined;
  const writeSession = adapters.supabaseWriteSession;
  const readSession = adapters.supabaseReadSession;
  const fetchWise = createFetchWiseTransactions(config);

  return [
    {
      descriptor: {
        id: OBSIDIAN_VAULT_CAPABILITY_ID,
        description: "Read, write, search, and send files from the Obsidian vault.",
        grantable: true,
      },
      isAvailable: () => vault !== undefined,
      resolveTools: () => {
        if (!vault) {
          throw new Error("obsidian-vault capability requires a configured Obsidian vault.");
        }

        return createObsidianVaultTools(vault, sendFile);
      },
    },
    {
      descriptor: {
        id: FINANCE_DOMAIN_CAPABILITY_ID,
        description: "Execute SQL, fetch Wise transactions, and load expense categories.",
        grantable: false,
        reservedForAgentIds: ["finance"],
      },
      isAvailable: () => writeSession !== undefined,
      resolveTools: () => {
        if (!writeSession) {
          throw new Error("finance-domain capability requires a configured Supabase write session.");
        }

        return createFinanceTools(
          (sql) => writeSession.executeSql(sql),
          {
            writeAccess: true,
            ...(fetchWise ? { fetchWise } : {}),
          },
        );
      },
    },
    {
      descriptor: {
        id: FINANCE_DOMAIN_READ_CAPABILITY_ID,
        description: "Query the expense ledger with read-only SQL and category lookup.",
        grantable: true,
      },
      isAvailable: () => readSession !== undefined,
      resolveTools: () => {
        if (!readSession) {
          throw new Error(
            "finance-domain-read capability requires a configured Supabase read session.",
          );
        }

        return createFinanceTools(
          (sql) => readSession.executeSql(sql),
          { writeAccess: false },
        );
      },
    },
  ];
};
