import type { StructuredToolInterface } from "@langchain/core/tools";

export type CapabilityDescriptor = {
  id: string;
  description: string;
  requiresVault?: boolean;
  requiresSupabase?: boolean;
  requiresConfigurationRepos?: boolean;
  /** When true, a configuration agent may grant this capability to other agents. */
  configurable?: boolean;
};

export type CapabilityAvailabilityContext = {
  obsidianVaultPath?: string;
  supabaseAvailable?: boolean;
  configurationReposAvailable?: boolean;
};

export type CapabilityProvider<TDeps = Record<string, unknown>> = {
  descriptor: CapabilityDescriptor;
  resolveTools: (deps: TDeps) => StructuredToolInterface[];
};

export const isCapabilityAvailable = (
  descriptor: CapabilityDescriptor,
  context: CapabilityAvailabilityContext,
): boolean => {
  if (descriptor.requiresVault && !context.obsidianVaultPath) {
    return false;
  }

  if (descriptor.requiresSupabase && !context.supabaseAvailable) {
    return false;
  }

  if (descriptor.requiresConfigurationRepos && !context.configurationReposAvailable) {
    return false;
  }

  return true;
};

export const isCapabilityGrantable = (descriptor: CapabilityDescriptor): boolean =>
  descriptor.configurable !== false;
