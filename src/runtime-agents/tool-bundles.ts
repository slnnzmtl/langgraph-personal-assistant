import type { StructuredToolInterface } from "@langchain/core/tools";

import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import { createFinanceDomainToolsFromSession } from "./policies/finance/tools.js";
import { createObsidianVaultTools } from "./policies/obsidian/tools.js";
import {
  RUNTIME_TOOL_BUNDLE_CATALOG,
  RUNTIME_TOOL_BUNDLE_IDS,
  type RuntimeToolBundleCatalogEntry,
  type RuntimeToolBundleId,
} from "../core/types/agent.js";

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
};

export const createRuntimeToolBundleDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: RuntimeToolBundleDeps["fileSender"];
    supabaseSession?: RuntimeToolBundleDeps["supabaseSession"];
    cronTargetAgentIds?: readonly string[];
  } = {},
): RuntimeToolBundleDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
});

const resolveBundleTools = (
  bundleId: RuntimeToolBundleId,
  deps: RuntimeToolBundleDeps,
): StructuredToolInterface[] => {
  switch (bundleId) {
    case "none":
      return [];
    case "obsidian-vault":
      return createObsidianVaultTools(deps.obsidianVaultPath, deps.fileSender);
    case "finance-domain":
      if (!deps.supabaseSession) {
        throw new Error("finance-domain bundle requires a configured Supabase session.");
      }
      return createFinanceDomainToolsFromSession(deps.supabaseSession);
    default:
      throw new Error(`Unknown runtime tool bundle: ${bundleId as string}`);
  }
};

export const listAvailableRuntimeToolBundles = (
  deps: RuntimeToolBundleDeps,
): RuntimeToolBundleCatalogEntry[] =>
  RUNTIME_TOOL_BUNDLE_CATALOG.filter((entry) => {
    const catalogEntry = entry as RuntimeToolBundleCatalogEntry;

    if (catalogEntry.requiresSupabase && !deps.supabaseSession) {
      return false;
    }

    if (catalogEntry.requiresVault && !deps.obsidianVaultPath) {
      return false;
    }

    return true;
  });

export const validateRuntimeToolBundleIds = (
  bundleIds: RuntimeToolBundleId[],
  deps: RuntimeToolBundleDeps,
): void => {
  const availableIds = new Set(listAvailableRuntimeToolBundles(deps).map((entry) => entry.id));

  for (const bundleId of bundleIds) {
    if (!(RUNTIME_TOOL_BUNDLE_IDS as readonly string[]).includes(bundleId)) {
      throw new Error(`Unknown tool bundle: ${bundleId}`);
    }

    if (!availableIds.has(bundleId)) {
      throw new Error(`Tool bundle is unavailable in this deployment: ${bundleId}`);
    }
  }
};

export const resolveRuntimeToolBundles = (
  bundleIds: RuntimeToolBundleId[],
  deps: RuntimeToolBundleDeps,
): StructuredToolInterface[] => {
  validateRuntimeToolBundleIds(bundleIds, deps);

  const seen = new Set<string>();
  const tools: StructuredToolInterface[] = [];

  for (const bundleId of bundleIds) {
    for (const tool of resolveBundleTools(bundleId, deps)) {
      if (seen.has(tool.name)) {
        continue;
      }

      seen.add(tool.name);
      tools.push(tool);
    }
  }

  return tools;
};

export const formatRuntimeToolBundleCatalog = (deps: RuntimeToolBundleDeps): string => {
  const entries = listAvailableRuntimeToolBundles(deps);

  if (entries.length === 0) {
    return "No runtime tool bundles are available in this deployment.";
  }

  return entries
    .map((entry) => `- ${entry.id}: ${entry.description}`)
    .join("\n");
};
