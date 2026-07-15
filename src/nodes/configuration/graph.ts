import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { createSubAgent } from "../create-sub-agent.js";
import { createConfigurationNode } from "./config-node.js";
import type { CronJobRepository, RuntimeCronService } from "../../cron/types.js";

export const CONFIGURATION_MAX_STEPS = 10;

type ConfigurationSubgraphDeps = {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  options: {
    repository: CronJobRepository;
    runtimeCron?: RuntimeCronService | undefined;
  };
};

export const createConfigurationSubgraphWrapper = (
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  options: ConfigurationSubgraphDeps["options"],
) =>
  createSubAgent<ConfigurationSubgraphDeps>({
    name: "Configuration",
    maxSteps: CONFIGURATION_MAX_STEPS,
    deps: { model, tools, options },
    createTools: (deps) => deps.tools,
    createLlmNode: (deps) => createConfigurationNode(deps.model, deps.tools, deps.options),
  });
