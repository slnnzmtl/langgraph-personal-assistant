import {
  createCapabilityCatalog,
  createSystemConfigCapabilityProviders,
  type CapabilityCatalog,
} from "@personal-assistant/supervisor-framework";
import { createPersonalCapabilityProviders } from "../../src/runtime-agents/capabilities.js";

/** Personal domain providers + system-config providers (matches bootstrap when systemAgent is enabled). */
export const createPersonalCapabilityCatalog = (
  includeSystemConfig = true,
): CapabilityCatalog =>
  createCapabilityCatalog([
    ...createPersonalCapabilityProviders(),
    ...(includeSystemConfig ? createSystemConfigCapabilityProviders() : []),
  ]);
