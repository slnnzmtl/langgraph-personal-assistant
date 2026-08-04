import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createCronRunner } from "../../../src/framework/cron/cron-runner.js";
import { buildCronTriggerForJob } from "../../../src/framework/cron/cron-triggers.js";

const financeSyncTrigger = buildCronTriggerForJob("finance", "finance-sync");

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("createCronRunner", () => {
  it("creates a unique thread id for each scheduled run", async () => {
    const invoke = vi.fn().mockResolvedValue({ messages: [new AIMessage("Completed")] });
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });

    expect(invoke).toHaveBeenCalledTimes(2);

    const firstConfig = invoke.mock.calls[0]?.[1];
    const secondConfig = invoke.mock.calls[1]?.[1];

    expect(firstConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(secondConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(firstConfig?.configurable?.thread_id).not.toBe(secondConfig?.configurable?.thread_id);
  });

  it("sends a synthetic human message with the scheduled trigger content", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });

    expect(invoke).toHaveBeenCalledTimes(1);

    const input = invoke.mock.calls[0]?.[0];
    expect(input?.messages).toHaveLength(1);
    expect(input?.messages[0]).toBeInstanceOf(HumanMessage);
    expect(input?.messages[0]?.content).toBe(financeSyncTrigger);
  });

  it("includes cron payload text in the llm input without changing the trigger line", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError: vi.fn() });

    await runner.run({
      jobName: "finance-sync",
      trigger: "SYSTEM_CRON_TRIGGER:finance:finance-sync",
      payload: "Sync the Wise transactions for yesterday.",
    });

    const input = invoke.mock.calls[0]?.[0];
    expect(input?.messages).toHaveLength(1);
    expect(input?.messages[0]?.content).toContain("SYSTEM_CRON_TRIGGER:finance:finance-sync");
    expect(input?.messages[0]?.content).toContain("Payload:");
    expect(input?.messages[0]?.content).toContain("Sync the Wise transactions for yesterday.");
  });

  it("skips overlapping runs when the ledger rejects a concurrent claim", async () => {
    const invoke = vi.fn().mockResolvedValue({ messages: [new AIMessage("Completed")] });
    const ledger = {
      tryBeginRun: vi
        .fn()
        .mockReturnValueOnce({
          runId: "run-1",
          jobName: "finance-sync",
          trigger: financeSyncTrigger,
          status: "running" as const,
          startedAt: new Date().toISOString(),
        })
        .mockReturnValueOnce(null),
      completeRun: vi.fn(),
      getLatestRun: vi.fn(),
    };
    const runner = createCronRunner({
      getGraph: () => ({ invoke }),
      onError: vi.fn(),
      ledger,
    });

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(ledger.completeRun).toHaveBeenCalledWith("run-1", { status: "succeeded" });
  });

  it("skips overlapping runs for the same job while a prior run is still active", async () => {
    const inFlight = deferred<void>();
    const invoke = vi.fn().mockReturnValue(inFlight.promise);
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError: vi.fn() });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    await Promise.resolve();

    await expect(
      runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger }),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;
  });

  it("captures graph errors without throwing from the scheduled callback", async () => {
    const error = new Error("graph failed");
    const invoke = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError });

    await expect(
      runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: financeSyncTrigger,
      }),
    );
  });

  it("reports cron lifecycle events around a successful run", async () => {
    const invoke = vi.fn().mockResolvedValue({ messages: [new AIMessage("Raw result")] });
    const reporter = {
      onStart: vi.fn(async () => undefined),
      onProgress: vi.fn(async () => undefined),
      onSuccess: vi.fn(async () => undefined),
      onError: vi.fn(async () => undefined),
    };
    const runner = createCronRunner({ getGraph: () => ({ invoke }), onError: vi.fn(), reporter });

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });

    expect(reporter.onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: financeSyncTrigger,
      }),
    );
    expect(reporter.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: "finance-sync",
      }),
      "Dispatching scheduled workflow.",
    );
    expect(reporter.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: financeSyncTrigger,
        messages: [expect.any(AIMessage)],
        summary: "Raw result",
      }),
    );
    expect(reporter.onError).not.toHaveBeenCalled();
  });

  it("allows later runs after an in-flight execution settles", async () => {
    const inFlight = deferred<void>();
    const invoke = vi
      .fn()
      .mockReturnValueOnce(inFlight.promise)
      .mockResolvedValueOnce({ messages: [new AIMessage("Completed")] });
    const runner = createCronRunner({
      getGraph: () => ({ invoke }),
      onError: vi.fn(),
    });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    await Promise.resolve();

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;

    await runner.run({ jobName: "finance-sync", trigger: financeSyncTrigger });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("cron summary passthrough", () => {
  it("uses the final assistant message as the success summary", async () => {
    const graphInvoke = vi.fn().mockResolvedValue({
      messages: [
        new HumanMessage("SYSTEM_CRON_TRIGGER:obsidian:routine-note-creation\n\nPayload:\nCreate today's routine note."),
        new AIMessage({ content: "", tool_calls: [{ name: "read_file", args: {}, id: "read-1" }] }),
        new ToolMessage({ content: "Yesterday tasks: - [ ] Review inbox", tool_call_id: "read-1", name: "read_file" }),
        new AIMessage({ content: "", tool_calls: [{ name: "write_file", args: {}, id: "write-1" }] }),
        new ToolMessage({ content: "Success: Updated today's note.", tool_call_id: "write-1", name: "write_file" }),
        new AIMessage("Updated today's routine note with carried-forward tasks."),
      ],
    });
    const reporter = {
      onSuccess: vi.fn(async () => undefined),
    };
    const runner = createCronRunner({ getGraph: () => ({ invoke: graphInvoke }), onError: vi.fn(), reporter });

    await runner.run({ jobName: "routine-note-creation", trigger: "SYSTEM_CRON_TRIGGER:obsidian:routine-note-creation" });

    expect(reporter.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Updated today's routine note with carried-forward tasks.",
      }),
    );
  });
});

describe("cron summary ordering", () => {
  it("continues a pending tool-call result before reporting the terminal summary", async () => {
    const graphInvoke = vi.fn()
      .mockResolvedValueOnce({ messages: [new AIMessage({ content: "", tool_calls: [{ name: "read_markdown_file", args: {}, id: "1" }] })] })
      .mockResolvedValueOnce({ messages: [new AIMessage("Completed note update")] });
    const reporter = {
      onSuccess: vi.fn(async () => undefined),
    };
    const runner = createCronRunner({ getGraph: () => ({ invoke: graphInvoke }), onError: vi.fn(), reporter });

    await runner.run({ jobName: "routine-note-creation", trigger: "SYSTEM_CRON_TRIGGER:obsidian:routine-note-creation" });

    expect(graphInvoke).toHaveBeenCalledTimes(2);
    expect(reporter.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Completed note update",
      }),
    );
  });
});
