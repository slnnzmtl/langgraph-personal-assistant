export {
  SYSTEM_AGENT_ID,
  SYSTEM_AGENT_EPOCH,
  SYSTEM_CONFIG_CAPABILITY_ID,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
} from "./constants.js";

export {
  createSystemAgentDefinition,
  isSystemAgentId,
} from "./definition.js";

export {
  wrapRepositoryWithSystemAgent,
  seedSystemAgent,
  type SystemAgentRepository,
} from "./repository.js";

export type {
  SystemAgentOptions,
  SystemConfigDeps,
  SystemConfigToolsOptions,
  SystemCronJob,
} from "./types.js";

export {
  SYSTEM_CONFIG_CAPABILITY_DESCRIPTORS,
  createSystemConfigCapabilityProviders,
  createSystemConfigCapabilityCatalog,
  mergeCapabilityCatalogs,
  toSystemConfigAvailabilityContext,
} from "./capabilities.js";

export { createSystemConfigTools } from "./tools/system-config-tools.js";
export {
  formatCronJobForDisplay,
  createCronTools,
} from "./tools/cron-tools.js";
export {
  formatRuntimeAgentSummary,
  formatRuntimeAgentPreview,
  RUNTIME_AGENT_RESTART_REQUIRED_NOTE,
  createRuntimeAgentTools,
} from "./tools/runtime-agent-tools.js";
export { createSkillCrudTools } from "./tools/skill-tools.js";

export {
  buildSkillModuleOwnerPattern,
  createSystemAgentNodeHooks,
  formatSystemAgentSkillCatalog,
  isSystemAgentSkillCatalogRequest,
  isSkillMutatingIntent,
  isSkillListDisplayIntent,
  isSkillPreviewDisplayIntent,
  shouldShortCircuitReadOnlySkillTool,
} from "./policy/hooks.js";

export {
  createSystemAgentPolicy,
  type SystemAgentPolicyOptions,
} from "./policy/policy.js";
