import { describe, expect, it, vi } from "vitest";

import type { CompiledSupervisorGraph } from "@personal-assistant/supervisor-framework";
import { reconcileRuntimeAgents } from "../../src/app/composition/reconcile-runtime-agents.js";
import type { SupervisorGraphRef } from "../../src/app/composition/supervisor-graph-ref.js";

describe("reconcileRuntimeAgents", () => {
  it("delegates to graphRef.recompile", async () => {
    const graph = { invoke: vi.fn() } as unknown as CompiledSupervisorGraph;
    const graphRef: SupervisorGraphRef = {
      getGraph: () => graph,
      getCronTargetAgentIds: () => ["finance"],
      recompile: vi.fn(async () => true),
    };

    const changed = await reconcileRuntimeAgents(graphRef);

    expect(changed).toBe(true);
    expect(graphRef.recompile).toHaveBeenCalledTimes(1);
  });
});
