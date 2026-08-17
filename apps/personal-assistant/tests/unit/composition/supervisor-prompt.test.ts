import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadSupervisorDynamicContext,
  loadSupervisorSystemPrompt,
} from "../../../src/prompts/load.js";

describe("supervisor prompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the supervisor system prompt from the markdown file", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
  });

  it("tells the supervisor not to transcribe screenshot images when routing", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("<routing_rules>");
    expect(prompt).toContain("do not summarize, describe, or transcribe attached images yourself");
    expect(prompt).toContain("Specialists see scoped history plus the current user message");
  });

  it("tells the supervisor to route list agents requests to configuration for runtime agents", () => {
    const prompt = loadSupervisorSystemPrompt();

    expect(prompt).toContain("list runtime agents");
    expect(prompt).toContain("list, show, create, edit, enable, disable, or delete runtime sub-agents");
  });

  it("keeps datetime metadata in the dynamic context outside the static cacheable prompt", () => {
    const currentInstant = new Date("2026-07-05T12:34:56.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(currentInstant);

    const prompt = loadSupervisorSystemPrompt();
    const dynamic = loadSupervisorDynamicContext();

    expect(prompt).toContain("You are the Root Supervisor for a private personal assistant.");
    expect(prompt).not.toContain("<system_metadata>");
    expect(prompt).not.toContain("CURRENT DATETIME:");
    expect(dynamic).toContain("<system_metadata>");
    expect(dynamic).toContain("CURRENT DATETIME: 2026-07-05T12:34:56 UTC");
  });
});
