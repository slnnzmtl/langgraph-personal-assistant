import { z } from "zod";

import { ROUTE_NAMES } from "./state.js";

export const MVPRoutingSchema = z.object({
  next: z
    .enum(ROUTE_NAMES)
    .describe(
      "The next graph node to execute. Route to Finance_SG for money, expenses, transactions, budgets, or banking. Route to Obsidian_SG for notes, plans, todos, markdown vault edits, summaries, or task status updates. Route to Config_SG for scheduler setup, cron messages, reminders, recurring tasks, configuration requests, or listing/showing/reading/managing agent skills. Use FINISH for general chat or any request you can answer directly.",
    ),
  reply: z
    .string()
    .optional()
    .describe(
      "The conversational response sent back to the user. Include this whenever 'next' is 'FINISH'. Omit it when routing to a specialist sub-graph.",
    ),
});

export type RoutingDecision = z.infer<typeof MVPRoutingSchema>;