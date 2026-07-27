import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSupervisorSystemPrompt } from "../../../src/prompts/load.js";

describe("supervisor prompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
  });

  it("tells the supervisor not to transcribe screenshot images in delegation prompts", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("<delegation_rules>");
    expect(prompt).toContain("DO NOT summarize, describe, or transcribe attached images yourself");
    expect(prompt).toContain("pass the raw image context directly to the specialist");
  });

  it("tells the supervisor to route list agents requests to configuration for runtime agents", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("List all runtime agents.");
    expect(prompt).toContain("list, show, create, edit, enable, disable, or delete runtime sub-agents");
  });

  it("includes the current datetime in the shared system prompt", () => {
    const currentInstant = new Date("2026-07-05T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
    expect(prompt).toContain("CURRENT DATETIME: 2026-07-05T12:34:56 UTC");
    expect(prompt.indexOf("You are the Root Supervisor")).toBeLessThan(
      prompt.indexOf("<system_metadata>"),
    );
  });
});
