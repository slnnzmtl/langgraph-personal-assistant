import type { RuntimeAgentNodeHooks } from "../../core/execution/runtime-node.js";
import { createRuntimeShellHooks } from "../../core/execution/runtime-shell.js";
import type { RuntimeShellFormatters } from "../../core/system-context.js";

export const createFinanceNodeHooks = (
  shellFormatters?: RuntimeShellFormatters,
): RuntimeAgentNodeHooks => {
  if (!shellFormatters) {
    throw new Error("createFinanceNodeHooks requires runtime shell formatters.");
  }

  return createRuntimeShellHooks(shellFormatters, {
    logLabel: "finance-system-prompt",
    buildErrorMessage: (error) =>
      `Unable to complete finance request: ${error instanceof Error ? error.message : "Unknown error during finance request"}`,
  });
};
