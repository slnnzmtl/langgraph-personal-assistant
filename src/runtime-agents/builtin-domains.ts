import type { AppConfig } from "../config.js";
import { loadSystemPromptByKey } from "../prompts/load-system-prompt.js";
import type { RuntimeAgentDefinition } from "../core/types/agent.js";
import type { RuntimeToolBundleId } from "./tool-bundles.js";

export {
  CONFIGURATOR_AGENT_ID,
  CONFIGURATOR_SPEC,
  BUILTIN_DOMAIN_SPECS,
  BUILTIN_DOMAIN_IDS,
  buildDefaultRuntimeAgents,
  resolveBuiltinModelName,
  applyLocalModuleAvailability,
  buildSkillModuleOwnerPattern,
  buildBuiltinDomainOwnerPattern,
} from "../app/composition/bootstrap-agents.js";

export type { ConfiguratorSpec, LocalModuleAvailabilityOptions } from "../app/composition/bootstrap-agents.js";
