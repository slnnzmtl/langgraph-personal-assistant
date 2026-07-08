import { z } from "zod";

import { ROUTE_NAMES } from "./state.js";

export const MVPRoutingSchema = z.object({
  next: z
    .enum(ROUTE_NAMES)
    .describe(
      "The next graph node to execute. Route to Finance_SG for money, expenses, transactions, budgets, or banking. Route to Obsidian_SG for notes, plans, todos, markdown vault edits, summaries, or task status updates. Route to Config_SG for scheduler setup, cron messages, reminders, recurring tasks, or configuration requests. Use FINISH ONLY for general chat or if you can fully answer the user directly.",
    ),
  reply: z
    .string()
    .optional()
    .describe(
      "The conversational response sent back to the user. This field is REQUIRED and must not be empty if the 'next' field is set to 'FINISH'. Leave undefined if routing to a sub-graph.",
    ),
  })
  .refine(
    (data) => {
      if (data.next === "FINISH") {
        return typeof data.reply === "string" && data.reply.trim().length > 0;
      }
      return true;
    },
    {
      message: "The 'reply' field is required and cannot be empty when routing to 'FINISH'",
      path: ["reply"],
    }
  );

export type RoutingDecision = z.infer<typeof MVPRoutingSchema>;