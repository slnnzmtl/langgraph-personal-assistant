import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { createSubAgent } from "../create-sub-agent.js";
import { createConfigurationNode } from "./config-node.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";
import type { SkillScopedToolContext } from "../../tools/skill-scoped-registry.js";

export const CONFIGURATION_MAX_STEPS = 10;

type ConfigurationSubgraphDeps = {
  model: BaseChatModel;
  tools: SkillScopedToolContext;
  options: {
    repository: CronJobRepository;
    runtimeCron?: RuntimeCronService | undefined;
  };
};

export const createConfigurationSubgraphWrapper = (
  model: BaseChatModel,
  tools: SkillScopedToolContext,
  options: ConfigurationSubgraphDeps["options"],
) =>
  createSubAgent<ConfigurationSubgraphDeps>({
    name: "Configuration",
    maxSteps: CONFIGURATION_MAX_STEPS,
    deps: { model, tools, options },
    createTools: (deps) => deps.tools,
    createLlmNode: (deps, toolSource) => createConfigurationNode(deps.model, toolSource, deps.options),
  });
