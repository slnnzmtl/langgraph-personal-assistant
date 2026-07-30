import type { StructuredToolInterface } from "@langchain/core/tools";

export type CapabilityDescriptor = {
  id: string;
  description: string;
  /** When false, a configuration agent may not grant this capability to other agents. Default true. */
  grantable?: boolean;
};

export const configurationReposAvailable = (deps: {
  cronJobRepository?: unknown;
  runtimeAgentRepository?: unknown;
}): boolean =>
  deps.cronJobRepository !== undefined && deps.runtimeAgentRepository !== undefined;

export type CapabilityProvider<TDeps = Record<string, unknown>> = {
  descriptor: CapabilityDescriptor;
  isAvailable: (deps: TDeps) => boolean;
  isGrantable?: (deps: TDeps) => boolean;
  resolveTools: (deps: TDeps) => StructuredToolInterface[];
};

export const isCapabilityGrantable = (
  provider: CapabilityProvider,
  deps: Record<string, unknown>,
): boolean => {
  if (provider.isGrantable) {
    return provider.isGrantable(deps);
  }

  return provider.descriptor.grantable !== false && provider.isAvailable(deps);
};
