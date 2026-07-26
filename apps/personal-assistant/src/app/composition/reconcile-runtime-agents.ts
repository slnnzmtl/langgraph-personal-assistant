import type { SupervisorGraphRef } from "./supervisor-graph-ref.js";

export const reconcileRuntimeAgents = async (
  graphRef: SupervisorGraphRef,
): Promise<boolean> => graphRef.recompile();
