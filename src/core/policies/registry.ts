import type { RuntimeAgentPolicy } from "../types/policy.js";

export type PolicyRegistry = {
  get(executor: string): RuntimeAgentPolicy;
};

export const createPolicyRegistry = (policies: RuntimeAgentPolicy[] = []): PolicyRegistry => {
  const registry = new Map(policies.map((policy) => [policy.executor, policy]));

  return {
    get(executor: string): RuntimeAgentPolicy {
      const policy = registry.get(executor);

      if (!policy) {
        throw new Error(`No runtime agent policy registered for executor: ${executor}`);
      }

      return policy;
    },
  };
};
