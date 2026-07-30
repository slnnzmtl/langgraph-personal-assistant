import type { LoadPromptByKey } from "../agents/resolve-system-prompt.js";
import type { PromptLoggingHook } from "../ports/prompt-logging.js";
import type { PolicyContext } from "./policy-context.js";

export type GraphBundleContext<
  TCapabilityDeps extends Record<string, unknown> = Record<string, unknown>,
> = PolicyContext<TCapabilityDeps> & {
  loadPromptByKey: LoadPromptByKey;
  promptLogging?: PromptLoggingHook;
};
