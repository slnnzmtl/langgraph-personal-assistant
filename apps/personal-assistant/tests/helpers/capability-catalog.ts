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

export type CreateTestCapabilityCatalogOptions = {
  config?: Partial<AppConfig>;
  adapters?: PersonalAdapters;
  includeSystemConfig?: boolean;
};

/** Build personal capability providers (and optional system-config) for unit tests. */
export const createPersonalCapabilityCatalog = (
  options: CreateTestCapabilityCatalogOptions | boolean = true,
): CapabilityCatalog => {
  const normalized =
    typeof options === "boolean" ? { includeSystemConfig: options } : options;
  const includeSystemConfig = normalized.includeSystemConfig ?? true;
  const config = {
    obsidianVaultPath: "/tmp/vault",
    ...normalized.config,
  } as AppConfig;
  const adapters = normalized.adapters ?? {};

  const productProviders = buildPersonalCapabilityProviders({
    config,
    adapters,
  });

  return createCapabilityCatalog([
    ...productProviders,
    ...(includeSystemConfig
      ? (createSystemConfigCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[])
      : []),
  ]);
};

/** Product providers only (excludes framework system-config providers). */
export const createProductCapabilityCatalog = (
  options: Omit<CreateTestCapabilityCatalogOptions, "includeSystemConfig"> = {},
): CapabilityCatalog =>
  createPersonalCapabilityCatalog({ ...options, includeSystemConfig: false });
