import type { SkillScopedToolContext } from "../../../tools/skill-scoped-registry.js";
import { CONFIGURATION_MAX_STEPS } from "../../constants.js";
import { createSubAgent } from "../../execution/create-sub-agent.js";
import type { RuntimeAgentExecutionContext } from "../../execution-context.js";
import { withResolvedSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentPolicy } from "../types.js";
import { createConfigurationNode } from "./node.js";
import { createConfigurationSkillScopedTools } from "./tools.js";

export const configurationPolicy: RuntimeAgentPolicy = {
  executor: "configuration",
  createHandler: (context, definition) => {
    const resolvedDefinition = withResolvedSystemPrompt(definition);
    const configurationTools = createConfigurationSkillScopedTools(
      context.cronJobRepository,
      context.repository,
      context.bundleDeps,
    );

    return createSubAgent({
      name: "Configuration",
      maxSteps: resolvedDefinition.maxSteps ?? CONFIGURATION_MAX_STEPS,
      deps: {
        model: context.models.configuration,
        tools: configurationTools,
        options: {
          repository: context.cronJobRepository,
          runtimeCron: context.runtimeCron,
          definition: resolvedDefinition,
        },
      },
      createTools: (deps) => deps.tools,
      createLlmNode: (deps, toolSource) => createConfigurationNode(deps.model, toolSource, deps.options),
    });
  },
};

export type { SkillScopedToolContext };
