import type { RuntimeAgentExecutor } from "../types.js";
import { configurationPolicy } from "./configuration/policy.js";
import { financePolicy } from "./finance/policy.js";
import { genericPolicy } from "./generic.js";
import { obsidianPolicy } from "./obsidian/policy.js";
import type { RuntimeAgentPolicy } from "./types.js";

const RUNTIME_AGENT_POLICIES: RuntimeAgentPolicy[] = [
  genericPolicy,
  financePolicy,
  obsidianPolicy,
  configurationPolicy,
];

const policyByExecutor = new Map<RuntimeAgentExecutor, RuntimeAgentPolicy>(
  RUNTIME_AGENT_POLICIES.map((policy) => [policy.executor, policy]),
);

export const getRuntimeAgentPolicy = (executor: RuntimeAgentExecutor): RuntimeAgentPolicy => {
  const policy = policyByExecutor.get(executor);

  if (!policy) {
    throw new Error(`No runtime agent policy registered for executor: ${executor}`);
  }

  return policy;
};

export const listRuntimeAgentPolicies = (): RuntimeAgentPolicy[] => [...RUNTIME_AGENT_POLICIES];
