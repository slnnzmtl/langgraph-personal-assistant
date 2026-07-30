import {
  type CapabilityCatalog,
  type CronJobRepository,
  type LoadPromptByKey,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";

export type PersonalCapabilityDeps = {
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
  loadPromptByKey?: LoadPromptByKey;
};
