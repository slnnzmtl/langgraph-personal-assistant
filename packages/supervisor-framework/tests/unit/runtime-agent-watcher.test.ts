import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchCallbackHolder: { current?: ((event: string, filename: string | null) => void) | undefined } = {};
const mockWatcherClose = vi.fn();

vi.mock("node:fs", () => ({
  watch: vi.fn((_directory: string, callback: (event: string, filename: string | null) => void) => {
    watchCallbackHolder.current = callback;
    return { close: mockWatcherClose };
  }),
}));

import { watchRuntimeAgentDefinitions } from "../../src/framework/runtime-agent-watcher.js";

describe("watchRuntimeAgentDefinitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchCallbackHolder.current = undefined;
    mockWatcherClose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes recompile when the watched file changes", async () => {
    const recompile = vi.fn().mockResolvedValue(true);
    watchRuntimeAgentDefinitions("/data/runtime-agents.json", { recompile });

    watchCallbackHolder.current?.("change", "runtime-agents.json");
    expect(recompile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(recompile).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to other filenames in the same directory", async () => {
    const recompile = vi.fn().mockResolvedValue(true);
    watchRuntimeAgentDefinitions("/data/runtime-agents.json", { recompile });

    watchCallbackHolder.current?.("change", "cron-jobs.json");
    await vi.advanceTimersByTimeAsync(250);

    expect(recompile).not.toHaveBeenCalled();
  });

  it("close clears pending timers and closes the watcher", async () => {
    const recompile = vi.fn().mockResolvedValue(true);
    const watcher = watchRuntimeAgentDefinitions("/data/runtime-agents.json", { recompile });

    watchCallbackHolder.current?.("change", "runtime-agents.json");
    watcher.close();
    await vi.advanceTimersByTimeAsync(250);

    expect(mockWatcherClose).toHaveBeenCalledTimes(1);
    expect(recompile).not.toHaveBeenCalled();
  });
});
