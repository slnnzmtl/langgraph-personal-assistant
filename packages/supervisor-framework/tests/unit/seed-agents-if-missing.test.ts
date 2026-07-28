import { describe, expect, it } from "vitest";

import {
  createRuntimeAgentRepository,
  seedAgentsIfMissing,
  toRuntimeAgentId,
  type CreateRuntimeAgentInput,
} from "@personal-assistant/supervisor-framework";
import path from "node:path";

const researcherInput: CreateRuntimeAgentInput = {
  name: "Researcher",
  description: "Answer factual questions.",
  systemPrompt: "You are a concise research assistant.",
  capabilityIds: ["none"],
  maxSteps: 6,
  enabled: true,
};

describe("seedAgentsIfMissing", () => {
  it("creates missing agents and is idempotent", async () => {
    const filePath = path.join(process.cwd(), ".tmp", `seed-agents-${process.pid}.json`);
    const repository = createRuntimeAgentRepository(process.cwd(), path.relative(process.cwd(), filePath));
    const seedAgents = seedAgentsIfMissing([researcherInput]);

    const first = await seedAgents(repository, { adapters: {} });
    const second = await seedAgents(repository, { adapters: {} });

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(toRuntimeAgentId(researcherInput.name));
    expect(second).toEqual(first);
  });
});
