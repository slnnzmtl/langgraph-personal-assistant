import {
  bootstrapSupervisorSystem,
  createAgentPolicy,
  resolveAgentTools,
} from "@personal-assistant/supervisor-framework";

import { seedAgents } from "./agents.js";
import { capabilityCatalog } from "./capabilities.js";
import type { AppConfig } from "./config.js";
import { GeminiConnector } from "./models/gemini-connector.js";

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
    seedAgents,
    buildRuntimeExecution: (_agents, _skillCatalog, ctx) => ({
      loadPromptByKey: (key) => `Prompt for ${key}`,
      runtimeAgentPolicy: createAgentPolicy({
        resolveTools: (definition, deps) =>
          resolveAgentTools(definition, ctx.capabilityCatalog, deps, {}),
      }),
    }),
    buildModels: () => ({
      generic: new GeminiConnector(config.googleApiKey, config.researcherModel).getModel(),
    }),
    buildCapabilityDeps: () => ({}),
  });

export type MinimalSupervisorSystem = Awaited<ReturnType<typeof createMinimalSupervisorSystem>>;
