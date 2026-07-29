import {
  createCapabilityCatalog,
  NONE_CAPABILITY_PROVIDER,
  type CapabilityCatalog,
  type CapabilityProvider,
} from "@personal-assistant/supervisor-framework";

import { webSearchTool } from "./tools.js";

export const WEB_SEARCH_CAPABILITY_ID = "web-search" as const;

const webSearchProvider: CapabilityProvider<Record<string, unknown>> = {
  descriptor: {
    id: WEB_SEARCH_CAPABILITY_ID,
    description: "Search the public web.",
    grantable: true,
  },
  isAvailable: () => true,
  resolveTools: () => [webSearchTool],
};

export const capabilityCatalog: CapabilityCatalog = createCapabilityCatalog([
  NONE_CAPABILITY_PROVIDER,
  webSearchProvider,
]);
