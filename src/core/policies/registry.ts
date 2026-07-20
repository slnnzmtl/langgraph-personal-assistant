import type { RuntimeAgentPolicy } from "../types/policy.js";

export class PolicyRegistry {
  private readonly policies = new Map<string, RuntimeAgentPolicy>();

  register(policy: RuntimeAgentPolicy): void {
    this.policies.set(policy.executor, policy);
  }

  registerAll(policies: RuntimeAgentPolicy[]): void {
    for (const policy of policies) {
      this.register(policy);
    }
  }

  get(executor: string): RuntimeAgentPolicy {
    const policy = this.policies.get(executor);

    if (!policy) {
      throw new Error(`No runtime agent policy registered for executor: ${executor}`);
    }

    return policy;
  }

  list(): RuntimeAgentPolicy[] {
    return [...this.policies.values()];
  }
}

export const createPolicyRegistry = (policies: RuntimeAgentPolicy[] = []): PolicyRegistry => {
  const registry = new PolicyRegistry();
  registry.registerAll(policies);
  return registry;
};
