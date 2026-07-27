import type { AppConfig } from "../../config.js";
import {
  bootstrapSupervisorSystem,
  deriveRuntimeAgentGraphFingerprint,
  type CompiledSupervisorGraph,
  type SupervisorSystemContext,
} from "@personal-assistant/supervisor-framework";
import type { CapabilityDeps } from "../../runtime-agents/builtin-capabilities.js";
import { buildPersonalSupervisorPack, type SupervisorSystemOptions } from "./personal-pack.js";
import type { GeminiConnector } from "../../connectors/llm-connector.js";

export type SupervisorGraphRef = {
  getGraph(): CompiledSupervisorGraph;
  recompile(): Promise<boolean>;
};

type PersonalAdapters = { supabaseSession?: CapabilityDeps["supabaseSession"] };

type PersonalBootstrapState = SupervisorSystemContext<
  AppConfig,
  CapabilityDeps,
  PersonalAdapters
>;

export const createSupervisorGraphRef = async (
  config: AppConfig,
  options: SupervisorSystemOptions,
  supervisorConnector: GeminiConnector,
): Promise<{
  graphRef: SupervisorGraphRef;
  bootstrap: PersonalBootstrapState;
}> => {
  const pack = buildPersonalSupervisorPack({
    config,
    options,
    supervisorLlm: supervisorConnector,
  });

  let bootstrap = await bootstrapSupervisorSystem(pack);
  let fingerprint = deriveRuntimeAgentGraphFingerprint(bootstrap.runtimeAgents);

  const graphRef: SupervisorGraphRef = {
    getGraph: () => bootstrap.graph,
    async recompile() {
      const runtimeAgentRepository = bootstrap.capabilityDeps.runtimeAgentRepository;
      if (!runtimeAgentRepository) {
        throw new Error("Runtime agent repository is not configured.");
      }

      const runtimeAgents = await pack.seedAgents(runtimeAgentRepository, {
        adapters: bootstrap.adapters,
      });
      const nextFingerprint = deriveRuntimeAgentGraphFingerprint(runtimeAgents);
      if (nextFingerprint === fingerprint) {
        return false;
      }

      const previousSession = bootstrap.adapters.supabaseSession;
      if (previousSession?.close) {
        await previousSession.close().catch(() => undefined);
      }

      bootstrap = await bootstrapSupervisorSystem(pack);
      fingerprint = deriveRuntimeAgentGraphFingerprint(bootstrap.runtimeAgents);
      console.log(`[RuntimeAgents] Recompiled supervisor graph (${fingerprint})`);
      return true;
    },
  };

  return { graphRef, bootstrap };
};
