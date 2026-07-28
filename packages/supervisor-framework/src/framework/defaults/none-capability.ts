import type { CapabilityProvider } from "../../capabilities/index.js";

export const NONE_CAPABILITY_ID = "none" as const;

export const NONE_CAPABILITY_PROVIDER: CapabilityProvider<Record<string, unknown>> = {
  descriptor: {
    id: NONE_CAPABILITY_ID,
    description: "Prompt-only agent with no tools.",
    grantable: true,
  },
  isAvailable: () => true,
  resolveTools: () => [],
};
