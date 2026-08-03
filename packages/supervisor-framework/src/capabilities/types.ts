import type { StructuredToolInterface } from "@langchain/core/tools";

export type CapabilityDescriptor = {
  id: string;
  description: string;
  /** When false, a configuration agent may not grant this capability to other agents. Default true. */
  grantable?: boolean;
  /**
   * When grantable is false, these persisted agent ids may still hold the capability
   * (e.g. finance → finance-domain). Empty/omitted ⇒ no custom agent may hold it.
   */
  reservedForAgentIds?: readonly string[];
};

export const configurationReposAvailable = (deps: {
  cronJobRepository?: unknown;
  runtimeAgentRepository?: unknown;
}): boolean =>
  deps.cronJobRepository !== undefined && deps.runtimeAgentRepository !== undefined;

export type CapabilityProvider<TDeps = Record<string, unknown>> = {
  descriptor: CapabilityDescriptor;
  isAvailable: (deps: TDeps) => boolean;
  resolveTools: (deps: TDeps) => StructuredToolInterface[];
};

export const isCapabilityGrantable = (
  provider: CapabilityProvider,
  deps: Record<string, unknown>,
): boolean =>
  provider.descriptor.grantable !== false && provider.isAvailable(deps);
