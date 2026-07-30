import {
  createCapabilityCatalog,
  createSystemConfigCapabilityProviders,
  type CapabilityCatalog,
  type CapabilityProvider,
} from "@personal-assistant/supervisor-framework";
import type { AppConfig } from "../../src/config.js";
import {
  buildPersonalCapabilityProviders,
} from "../../src/composition/personal-pack.js";
import type { PersonalAdapters } from "../../src/composition/personal-adapters.js";

export type BindTestDomainCatalogOptions = {
  config?: Partial<AppConfig>;
  adapters?: PersonalAdapters;
  includeSystemConfig?: boolean;
};

/** Build personal capability providers (and optional system-config) for unit tests. */
export const createPersonalCapabilityCatalog = (
  options: BindTestDomainCatalogOptions | boolean = true,
): CapabilityCatalog => {
  const normalized =
    typeof options === "boolean" ? { includeSystemConfig: options } : options;
  const includeSystemConfig = normalized.includeSystemConfig ?? true;
  const config = {
    obsidianVaultPath: "/tmp/vault",
    ...normalized.config,
  } as AppConfig;
  const adapters = normalized.adapters ?? {};

  const domainProviders = buildPersonalCapabilityProviders({
    config,
    adapters,
  });

  return createCapabilityCatalog([
    ...domainProviders,
    ...(includeSystemConfig
      ? (createSystemConfigCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[])
      : []),
  ]);
};

/** Product providers only (excludes framework system-config providers). */
export const createDomainCapabilityCatalog = (
  options: Omit<BindTestDomainCatalogOptions, "includeSystemConfig"> = {},
): CapabilityCatalog =>
  createPersonalCapabilityCatalog({ ...options, includeSystemConfig: false });
