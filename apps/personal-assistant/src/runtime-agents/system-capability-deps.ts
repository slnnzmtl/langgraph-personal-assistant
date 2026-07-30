import {
  type CapabilityCatalog,
  type CronJobRepository,
  type LoadPromptByKey,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";

/** System services for configuration tools / policy — domain clients are closed over in domain binders. */
export type PersonalCapabilityDeps = {
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
  loadPromptByKey?: LoadPromptByKey;
};
