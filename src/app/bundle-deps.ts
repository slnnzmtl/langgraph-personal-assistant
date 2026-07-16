import type { RuntimeAgentExecutionContext } from "../core/execution/context.js";
import type { RuntimeToolBundleDeps } from "../runtime-agents/bundle-deps.js";

export type AppBundleDeps = RuntimeToolBundleDeps & {
  cronTargetAgentIds?: readonly string[];
};

export type AppRuntimeAgentExecutionContext = RuntimeAgentExecutionContext<AppBundleDeps>;

export const getAppBundleDeps = (context: RuntimeAgentExecutionContext): AppBundleDeps =>
  context.bundleDeps as AppBundleDeps;

export const createAppBundleDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: RuntimeToolBundleDeps["fileSender"];
    supabaseSession?: RuntimeToolBundleDeps["supabaseSession"];
    cronTargetAgentIds?: readonly string[];
  } = {},
): AppBundleDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
});
