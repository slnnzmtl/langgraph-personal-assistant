import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { RuntimeAgentExecutionContext } from "../../src/core/execution/context.js";
import { createAppExecutionKit } from "../../src/app/register-defaults.js";
import {
  deriveCronTargetAgentIds,
  deriveExecutors,
  deriveModelKeys,
} from "../../src/app/composition/create-supervisor-system.js";
import type { RuntimeAgentRepository } from "../../src/core/agents/repository.js";
import { createRuntimeAgentExecutionContext as createCoreExecutionContext } from "../../src/core/execution/context.js";
import type { CronJobRepository, RuntimeCronService } from "../../src/cron/types.js";
import { buildTestRuntimeAgents } from "./runtime-agent-fixtures.js";
import type { RuntimeToolBundleDeps } from "../../src/runtime-agents/tool-bundles.js";
import { createFilesystemSkillCatalog } from "../../src/integrations/skills/filesystem-skill-catalog.js";

export type CreateAppRuntimeExecutionContextInput = {
  defaultModel: BaseChatModel;
  repository?: RuntimeAgentRepository;
  cronJobRepository: CronJobRepository;
  runtimeCron?: RuntimeCronService;
  bundleDeps: RuntimeToolBundleDeps;
  executors?: Iterable<string>;
};

export const createAppRuntimeExecutionContext = (
  input: CreateAppRuntimeExecutionContextInput,
): RuntimeAgentExecutionContext<RuntimeToolBundleDeps> => {
  const runtimeAgents = buildTestRuntimeAgents();
  const defaultModelKey = "generic";
  const executors = input.executors ?? deriveExecutors(runtimeAgents);
  const { loadPromptByKey, policyRegistry } = createAppExecutionKit(executors, {
    skillCatalog: createFilesystemSkillCatalog(),
  });
  const cronTargetAgentIds = input.bundleDeps.cronTargetAgentIds
    ?? deriveCronTargetAgentIds(runtimeAgents);

  return createCoreExecutionContext<RuntimeToolBundleDeps>({
    models: Object.fromEntries(
      [...deriveModelKeys(runtimeAgents, defaultModelKey)].map((modelKey) => [
        modelKey,
        input.defaultModel,
      ]),
    ),
    defaultModelKey,
    repository: input.repository ?? createRuntimeAgentRepositoryFake(),
    cronJobRepository: input.cronJobRepository,
    ...(input.runtimeCron ? { runtimeCron: input.runtimeCron } : {}),
    bundleDeps: {
      ...input.bundleDeps,
      cronTargetAgentIds,
    },
    loadPromptByKey,
    policyRegistry,
  });
};
