export {
  SYSTEM_AGENT_ID,
  SYSTEM_AGENT_DISPLAY_NAME,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
  createSystemAgentDefinition,
} from "./definition.js";

export {
  wrapRepositoryWithSystemAgent,
  type SystemAgentRepository,
} from "./repository.js";

export type {
  SystemAgentOptions,
  SystemConfigDeps,
  SystemConfigToolsOptions,
  SystemCronJob,
} from "./types.js";

export {
  mergeCapabilityCatalogs,
} from "./capabilities.js";

export { createSystemConfigTools } from "./tools/system-config-tools.js";

export { buildSkillModuleOwnerPattern } from "./skill-patterns.js";

export {
  createSystemAgentNodeHooks,
  createSystemAgentPolicy,
  type SystemAgentPolicyOptions,
} from "./policy.js";
