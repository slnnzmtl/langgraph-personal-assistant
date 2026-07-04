import { z } from "zod";

export const MVPRoutingSchema = z.object({
  next: z
    .enum(["Finance_SG", "Obsidian_SG", "FINISH"])
    .describe(
      "Route Finance_SG for money or expense tasks, Obsidian_SG for note-taking tasks, or FINISH for direct conversational replies.",
    ),
  reply: z
    .string()
    .optional()
    .describe("Provide a user-facing reply when the route is FINISH."),
});

export type RoutingDecision = z.infer<typeof MVPRoutingSchema>;