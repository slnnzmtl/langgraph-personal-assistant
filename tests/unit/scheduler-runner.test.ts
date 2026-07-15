import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { createSchedulerRunner } from "../../src/cron/scheduler-runner.js";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("createSchedulerRunner", () => {
  it("creates a unique thread id for each scheduled run", async () => {
    const invoke = vi.fn().mockResolvedValue({ messages: [new AIMessage("Completed")] });
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never, onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });

    expect(invoke).toHaveBeenCalledTimes(2);

    const firstConfig = invoke.mock.calls[0]?.[1];
    const secondConfig = invoke.mock.calls[1]?.[1];

    expect(firstConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(secondConfig?.configurable?.thread_id).toEqual(expect.any(String));
    expect(firstConfig?.configurable?.thread_id).not.toBe(secondConfig?.configurable?.thread_id);
  });

  it("sends a synthetic human message with the scheduled trigger content", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never, onError: vi.fn() });

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });

    expect(invoke).toHaveBeenCalledTimes(1);

    const input = invoke.mock.calls[0]?.[0];
    expect(input?.messages).toHaveLength(1);
    expect(input?.messages[0]).toBeInstanceOf(HumanMessage);
    expect(input?.messages[0]?.content).toBe("SYSTEM_CRON_TRIGGER:finance-sync");
  });

  it("includes cron payload text in the llm input without changing the trigger line", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never, onError: vi.fn() });

    await runner.run({
      jobName: "finance-sync",
      trigger: "SYSTEM_CRON_TRIGGER:Finance_SG:finance-sync",
      payload: "Sync the Wise transactions for yesterday.",
    });

    const input = invoke.mock.calls[0]?.[0];
    expect(input?.messages).toHaveLength(1);
    expect(input?.messages[0]?.content).toContain("SYSTEM_CRON_TRIGGER:Finance_SG:finance-sync");
    expect(input?.messages[0]?.content).toContain("Payload:");
    expect(input?.messages[0]?.content).toContain("Sync the Wise transactions for yesterday.");
  });

  it("skips overlapping runs for the same job while a prior run is still active", async () => {
    const inFlight = deferred<void>();
    const invoke = vi.fn().mockReturnValue(inFlight.promise);
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never, onError: vi.fn() });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await Promise.resolve();

    await expect(
      runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" }),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;
  });

  it("captures graph errors without throwing from the scheduled callback", async () => {
    const error = new Error("graph failed");
    const invoke = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never, onError });

    await expect(
      runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" }),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: "SYSTEM_CRON_TRIGGER:finance-sync",
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
    const summaryModel = { invoke: vi.fn().mockResolvedValue(new AIMessage("Model summary")) };
    const runner = createSchedulerRunner({ graph: { invoke }, summaryModel: summaryModel as never, onError: vi.fn(), reporter });

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });

    expect(reporter.onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: "finance-sync",
        trigger: "SYSTEM_CRON_TRIGGER:finance-sync",
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
        trigger: "SYSTEM_CRON_TRIGGER:finance-sync",
        messages: [expect.any(AIMessage)],
        summary: "Model summary",
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
    const runner = createSchedulerRunner({
      graph: { invoke },
      summaryModel: { invoke: vi.fn().mockResolvedValue(new AIMessage("summary")) } as never,
      onError: vi.fn(),
    });

    const firstRun = runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    await Promise.resolve();

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    expect(invoke).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await firstRun;

    await runner.run({ jobName: "finance-sync", trigger: "SYSTEM_CRON_TRIGGER:finance-sync" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("cron summary context", () => {
  it("sends the full sanitized dialog to the summary model", async () => {
    const graphInvoke = vi.fn().mockResolvedValue({
      messages: [
        new HumanMessage("SYSTEM_CRON_TRIGGER:Obsidian_SG:routine-note-creation\n\nPayload:\nCreate today\'s routine note."),
        new AIMessage({ content: "", tool_calls: [{ name: "read_file", args: {}, id: "read-1" }] }),
        new ToolMessage({ content: "Yesterday tasks: - [ ] Review inbox", tool_call_id: "read-1", name: "read_file" }),
        new AIMessage({ content: "", tool_calls: [{ name: "write_file", args: {}, id: "write-1" }] }),
        new ToolMessage({ content: "Success: Updated today's note.", tool_call_id: "write-1", name: "write_file" }),
        new AIMessage("Updated today\'s routine note with carried-forward tasks."),
      ],
    });
    const summaryInvoke = vi.fn().mockResolvedValue(new AIMessage("The routine note was updated."));
    const runner = createSchedulerRunner({ graph: { invoke: graphInvoke }, summaryModel: { invoke: summaryInvoke } as never, onError: vi.fn() });

    await runner.run({ jobName: "routine-note-creation", trigger: "SYSTEM_CRON_TRIGGER:Obsidian_SG:routine-note-creation" });

    const summaryInput = summaryInvoke.mock.calls[0]?.[0]?.[1]?.content as string;
    expect(summaryInput).toContain("Create today's routine note.");
    expect(summaryInput).toContain("Yesterday tasks: - [ ] Review inbox");
    expect(summaryInput).toContain("Success: Updated today's note.");
    expect(summaryInput).toContain("Updated today's routine note with carried-forward tasks.");
    expect(summaryInput).not.toContain("SYSTEM_CRON_TRIGGER:");
    expect(summaryInput).not.toContain("read-1");
  });
});

describe("cron summary ordering", () => {
  it("continues a pending tool-call result before summarizing", async () => {
    const graphInvoke = vi.fn()
      .mockResolvedValueOnce({ messages: [new AIMessage({ content: "", tool_calls: [{ name: "read_markdown_file", args: {}, id: "1" }] })] })
      .mockResolvedValueOnce({ messages: [new AIMessage("Completed note update")] });
    const summaryInvoke = vi.fn().mockResolvedValue(new AIMessage("Updated the routine note."));
    const runner = createSchedulerRunner({ graph: { invoke: graphInvoke }, summaryModel: { invoke: summaryInvoke } as never, onError: vi.fn() });

    await runner.run({ jobName: "routine-note-creation", trigger: "SYSTEM_CRON_TRIGGER:Obsidian_SG:routine-note-creation" });

    expect(graphInvoke).toHaveBeenCalledTimes(2);
    expect(summaryInvoke).toHaveBeenCalledTimes(1);
    expect(summaryInvoke.mock.calls[0]?.[0]?.[1]?.content).toContain("Completed note update");
  });
});
