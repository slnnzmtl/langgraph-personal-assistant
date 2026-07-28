import {
  createCapabilityCatalog,
  type CapabilityCatalog,
  type CapabilityProvider,
} from "@personal-assistant/supervisor-framework";

import { webSearchTool } from "./tools/web-search.js";

export const NONE_CAPABILITY_ID = "none" as const;
export const WEB_SEARCH_CAPABILITY_ID = "web-search" as const;

const capabilityProviders: CapabilityProvider<Record<string, unknown>>[] = [
  {
    descriptor: {
      id: NONE_CAPABILITY_ID,
      description: "Prompt-only agent with no tools.",
      grantable: true,
    },
    isAvailable: () => true,
    resolveTools: () => [],
  },
  {
    descriptor: {
      id: WEB_SEARCH_CAPABILITY_ID,
      description: "Search the public web.",
      grantable: true,
    },
    isAvailable: () => true,
    resolveTools: () => [webSearchTool],
  },
];

export const capabilityCatalog: CapabilityCatalog = createCapabilityCatalog(capabilityProviders);
