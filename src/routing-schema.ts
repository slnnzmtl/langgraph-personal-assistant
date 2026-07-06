import { z } from "zod";

import { ROUTE_NAMES } from "./state.js";

export const MVPRoutingSchema = z.object({
  next: z
    .enum(ROUTE_NAMES)
    .describe(
      "The next graph node to execute. Route to Finance_SG for money, expenses, transactions, budgets, or banking. Route to Obsidian_SG for notes, plans, todos, markdown vault edits, summaries, or task status updates. Use FINISH ONLY for general chat or if you can fully answer the user directly.",
    ),
  reply: z
    .string()
    .optional()
    .describe(
      "The conversational response sent back to the user. This field is REQUIRED and must not be empty if the 'next' field is set to 'FINISH'. Leave undefined if routing to a sub-graph.",
    ),
});

export type RoutingDecision = z.infer<typeof MVPRoutingSchema>;