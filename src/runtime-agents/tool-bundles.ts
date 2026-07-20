import type { StructuredToolInterface } from "@langchain/core/tools";

import type { RuntimeAgentRepository } from "../core/agents/repository.js";
import type { CronJobRepository } from "../cron/types.js";
import type { SupabaseMcpSession } from "../mcp/supabase.js";
import type { IFileSender } from "../telegram/file-sender.js";
import { createSystemConfigDomainTools } from "./policies/configuration/tools.js";
import { createFinanceDomainToolsFromSession } from "./policies/finance/tools.js";
import { createObsidianVaultTools } from "./policies/obsidian/tools.js";
import {
  RUNTIME_TOOL_BUNDLE_CATALOG,
  RUNTIME_TOOL_BUNDLE_IDS,
  type RuntimeToolBundleCatalogEntry,
  type RuntimeToolBundleId,
} from "./tool-bundle-catalog.js";

export type { RuntimeToolBundleCatalogEntry, RuntimeToolBundleId } from "./tool-bundle-catalog.js";
export {
  RUNTIME_TOOL_BUNDLE_CATALOG,
  RUNTIME_TOOL_BUNDLE_IDS,
  RuntimeToolBundleIdSchema,
} from "./tool-bundle-catalog.js";

export type RuntimeToolBundleDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
};

export const createRuntimeToolBundleDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: RuntimeToolBundleDeps["fileSender"];
    supabaseSession?: RuntimeToolBundleDeps["supabaseSession"];
    cronTargetAgentIds?: readonly string[];
    cronJobRepository?: CronJobRepository;
    runtimeAgentRepository?: RuntimeAgentRepository;
  } = {},
): RuntimeToolBundleDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
  ...(options.runtimeAgentRepository ? { runtimeAgentRepository: options.runtimeAgentRepository } : {}),
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
    case "system-config":
      if (!deps.cronJobRepository || !deps.runtimeAgentRepository) {
        throw new Error("system-config bundle requires cron and runtime agent repositories.");
      }
      return createSystemConfigDomainTools(deps);
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

    if (
      catalogEntry.requiresConfigurationRepos
      && (!deps.cronJobRepository || !deps.runtimeAgentRepository)
    ) {
      return false;
    }

    return true;
  });

export const validateRuntimeToolBundleIds = (
  bundleIds: readonly string[],
  deps: RuntimeToolBundleDeps,
): void => {
  const availableIds = new Set(listAvailableRuntimeToolBundles(deps).map((entry) => entry.id));

  for (const bundleId of bundleIds) {
    if (!(RUNTIME_TOOL_BUNDLE_IDS as readonly string[]).includes(bundleId)) {
      throw new Error(`Unknown tool bundle: ${bundleId}`);
    }

    if (!availableIds.has(bundleId as RuntimeToolBundleId)) {
      throw new Error(`Tool bundle is unavailable in this deployment: ${bundleId}`);
    }
  }
};

export const resolveRuntimeToolBundles = (
  bundleIds: readonly string[],
  deps: RuntimeToolBundleDeps,
): StructuredToolInterface[] => {
  validateRuntimeToolBundleIds(bundleIds, deps);

  const seen = new Set<string>();
  const tools: StructuredToolInterface[] = [];

  for (const bundleId of bundleIds) {
    for (const tool of resolveBundleTools(bundleId as RuntimeToolBundleId, deps)) {
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
