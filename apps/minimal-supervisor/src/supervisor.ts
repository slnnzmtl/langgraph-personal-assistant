import {
  bootstrapSupervisorSystem,
  buildDefaultRuntimeExecution,
  seedAgentsIfMissing,
} from "@personal-assistant/supervisor-framework";

import { researcherInput } from "./agents.js";
import { capabilityCatalog } from "./capabilities.js";
import type { AppConfig } from "./config.js";
import { GeminiConnector } from "@personal-assistant/llm-gemini";

export const createMinimalSupervisorSystem = async (config: AppConfig) =>
  bootstrapSupervisorSystem({
    config: {
      runtimeAgentsFilePath: config.runtimeAgentsFilePath,
      cronJobsFilePath: config.cronJobsFilePath,
      messageHistoryMaxTokens: config.messageHistoryMaxTokens,
    },
    capabilityCatalog,
    supervisorLlm: new GeminiConnector(config.googleApiKey, config.supervisorModel),
    loadSupervisorPrompt: () =>
      "Route factual questions to researcher. Reply directly for greetings.",
    seedAgents: seedAgentsIfMissing([researcherInput]),
    buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
      buildDefaultRuntimeExecution(ctx.capabilityCatalog, {
        loadPromptByKey: (key) => `Prompt for ${key}`,
      }),
    buildModels: () => ({
      generic: new GeminiConnector(config.googleApiKey, config.researcherModel).getModel(),
    }),
    buildCapabilityDeps: () => ({}),
  });

export type MinimalSupervisorSystem = Awaited<ReturnType<typeof createMinimalSupervisorSystem>>;
