export {
  BUILTIN_CAPABILITY_DESCRIPTORS as RUNTIME_TOOL_BUNDLE_CATALOG,
  RUNTIME_TOOL_BUNDLE_IDS,
  type RuntimeToolBundleCatalogEntry,
  type RuntimeToolBundleId,
} from "./tool-bundles.js";
export { createDefaultCapabilityCatalog } from "./tool-bundles.js";
import { createDefaultCapabilityCatalog } from "./tool-bundles.js";

export const RuntimeToolBundleIdSchema = createDefaultCapabilityCatalog().createIdSchema();
