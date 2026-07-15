import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SupabaseMcpSession } from "../../../mcp/supabase.js";
import { FINANCE_MAX_STEPS } from "../../constants.js";
import { createSubAgentOrStub } from "../../execution/create-sub-agent.js";
import type { RuntimeAgentExecutionContext } from "../../execution-context.js";
import { withResolvedSystemPrompt } from "../../prompt-resolver.js";
import type { RuntimeAgentDefinition } from "../../types.js";
import type { RuntimeAgentPolicy } from "../types.js";
import { createFinanceNode } from "./node.js";
import { createFinanceSkillScopedTools } from "./tools.js";

type FinancePolicyDeps = {
  session?: SupabaseMcpSession;
  model: BaseChatModel;
  definition: RuntimeAgentDefinition;
};

export const financePolicy: RuntimeAgentPolicy = {
  executor: "finance",
  createHandler: (context: RuntimeAgentExecutionContext, definition) => {
    const resolvedDefinition = withResolvedSystemPrompt(definition);

    return createSubAgentOrStub<FinancePolicyDeps>(
      (deps) => deps.session !== undefined,
      "Supabase session is not configured.",
      {
        name: "Finance",
        maxSteps: resolvedDefinition.maxSteps ?? FINANCE_MAX_STEPS,
        deps: {
          model: context.models.finance,
          definition: resolvedDefinition,
          ...(context.bundleDeps.supabaseSession
            ? { session: context.bundleDeps.supabaseSession }
            : {}),
        },
        createTools: (deps) => createFinanceSkillScopedTools(deps.session!),
        createLlmNode: (deps, tools) => createFinanceNode(deps.model, deps.definition, tools),
      },
    );
  },
};
