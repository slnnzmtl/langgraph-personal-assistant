import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { SupabaseMcpSession } from "../../mcp/supabase.js";
import { createCompiledSubAgentGraph, createSubAgentOrStub } from "../create-sub-agent.js";
import { createFinanceNode, createFinanceTools } from "./index.js";

export const FINANCE_MAX_STEPS = 10;

type FinanceSubgraphDeps = {
  session?: SupabaseMcpSession;
  model: BaseChatModel;
};

export const createCompiledFinanceSubgraph = (
  model: BaseChatModel,
  tools: ReturnType<typeof createFinanceTools>,
) => createCompiledSubAgentGraph("Finance", FINANCE_MAX_STEPS, createFinanceNode(model, tools), tools);

export const createFinanceSubgraphWrapper = (
  session: SupabaseMcpSession | undefined,
  model: BaseChatModel,
) =>
  createSubAgentOrStub(
    (deps) => deps.session !== undefined,
    "Supabase session is not configured.",
    {
      name: "Finance",
      maxSteps: FINANCE_MAX_STEPS,
      deps: { session, model },
      createTools: (deps) => createFinanceTools(deps.session!),
      createLlmNode: (deps, tools) => createFinanceNode(deps.model, tools),
    },
  );
