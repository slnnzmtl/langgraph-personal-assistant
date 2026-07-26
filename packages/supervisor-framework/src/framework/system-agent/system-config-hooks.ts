import type { RuntimeAgentDefinition } from "../../core/types/agent.js";
import { resolveAgentCapabilityIds } from "../../core/types/agent.js";
import type { RuntimeAgentExecutionContext } from "../../core/execution/context.js";
import { configurationReposAvailable } from "../../capabilities/index.js";
import { SYSTEM_CONFIG_CAPABILITY_ID, isSystemAgentId } from "./definition.js";
import type { SystemConfigDeps } from "./types.js";

export { SYSTEM_CONFIG_CAPABILITY_ID };

export const hasSystemConfigWriteCapability = (
  definition: Pick<RuntimeAgentDefinition, "id" | "capabilityIds">,
): boolean =>
  isSystemAgentId(definition.id)
  || resolveAgentCapabilityIds(definition).includes(SYSTEM_CONFIG_CAPABILITY_ID);

export const resolveSystemConfigDeps = (
  context: RuntimeAgentExecutionContext<SystemConfigDeps>,
  definition: RuntimeAgentDefinition,
): Record<string, never> | null => {
  if (!hasSystemConfigWriteCapability(definition)) {
    return {};
  }

  return configurationReposAvailable(context.capabilityDeps) ? {} : null;
};

export const SYSTEM_CONFIG_UNAVAILABLE_MESSAGE =
  "Configuration is unavailable because cron and runtime agent storage are not configured.";
