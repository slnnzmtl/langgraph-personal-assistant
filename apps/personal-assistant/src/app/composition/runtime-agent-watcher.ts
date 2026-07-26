import { watch } from "node:fs";
import path from "node:path";

import type { SupervisorGraphRef } from "./supervisor-graph-ref.js";

const RECOMPILE_DEBOUNCE_MS = 250;

export type RuntimeAgentWatcher = {
  close(): void;
};

export const watchRuntimeAgentDefinitions = (
  runtimeAgentsFilePath: string,
  graphRef: SupervisorGraphRef,
): RuntimeAgentWatcher => {
  let recompileTimer: NodeJS.Timeout | undefined;
  const watchedFileName = path.basename(runtimeAgentsFilePath);
  const watchedDirectory = path.dirname(runtimeAgentsFilePath);

  const scheduleRecompile = (): void => {
    if (recompileTimer) {
      clearTimeout(recompileTimer);
    }

    recompileTimer = setTimeout(() => {
      recompileTimer = undefined;
      void graphRef.recompile().catch((error: unknown) => {
        console.error("[RuntimeAgents] Failed to recompile graph after file change:", error);
      });
    }, RECOMPILE_DEBOUNCE_MS);
  };

  const watcher = watch(watchedDirectory, (event, filename) => {
    if (filename === watchedFileName) {
      scheduleRecompile();
    }
  });

  return {
    close() {
      watcher.close();
      if (recompileTimer) {
        clearTimeout(recompileTimer);
      }
    },
  };
};
