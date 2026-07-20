import { z } from "zod";

export const RUNTIME_TOOL_BUNDLE_CATALOG = [
  {
    id: "none",
    description: "Prompt-only agent with no tools.",
  },
  {
    id: "obsidian-vault",
    description: "Read, write, search, and send files from the Obsidian vault.",
    requiresVault: true,
  },
  {
    id: "finance-domain",
    description: "Execute SQL, fetch Wise transactions, and load expense categories.",
    requiresSupabase: true,
  },
  {
    id: "system-config",
    description: "Manage cron jobs, runtime agents, and skill definitions.",
    requiresConfigurationRepos: true,
  },
] as const;

export type RuntimeToolBundleId = (typeof RUNTIME_TOOL_BUNDLE_CATALOG)[number]["id"];

export type RuntimeToolBundleCatalogEntry = {
  id: RuntimeToolBundleId;
  description: string;
  requiresSupabase?: boolean;
  requiresVault?: boolean;
  requiresConfigurationRepos?: boolean;
};

export const RUNTIME_TOOL_BUNDLE_IDS = RUNTIME_TOOL_BUNDLE_CATALOG.map(
  (entry) => entry.id,
) as unknown as readonly RuntimeToolBundleId[];

export const RuntimeToolBundleIdSchema = z.enum(
  RUNTIME_TOOL_BUNDLE_CATALOG.map((entry) => entry.id) as [
    RuntimeToolBundleId,
    ...RuntimeToolBundleId[],
  ],
);
