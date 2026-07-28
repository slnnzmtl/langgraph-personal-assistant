import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeReconnectDelayMs,
  createSelfHealingMcpSession,
  type McpSessionLike,
} from "../../../src/integrations/mcp/self-healing-session.js";

const transportError = (code: string): Error =>
  Object.assign(new Error(`transport failure: ${code}`), { code });

const createSessionStub = (
  executeSql: McpSessionLike["executeSql"],
): McpSessionLike => ({
  executeSql,
  close: vi.fn().mockResolvedValue(undefined),
});

describe("createSelfHealingMcpSession", () => {
  it("connects eagerly at startup", async () => {
    const connect = vi.fn().mockResolvedValue(createSessionStub(vi.fn()));

    await createSelfHealingMcpSession({ connect });

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects and retries executeSql after a transport failure", async () => {
    const firstSession = createSessionStub(
      vi.fn().mockRejectedValueOnce(transportError("ECONNRESET")),
    );
    const secondSession = createSessionStub(
      vi.fn().mockResolvedValue([{ id: 1 }]),
    );
    const connect = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const onReconnect = vi.fn();

    const session = await createSelfHealingMcpSession({ connect, onReconnect });
    const result = await session.executeSql("SELECT 1");

    expect(result).toEqual([{ id: 1 }]);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstSession.close).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 0,
      error: expect.objectContaining({ code: "ECONNRESET" }),
    });
  });

  it("does not reconnect for non-transport application errors", async () => {
    const underlyingSession = createSessionStub(
      vi.fn().mockRejectedValue(new Error("syntax error at or near SELECT")),
    );
    const connect = vi.fn().mockResolvedValue(underlyingSession);

    const session = await createSelfHealingMcpSession({ connect });

    await expect(session.executeSql("SELECT FROM")).rejects.toThrow(/syntax error/i);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(underlyingSession.close).not.toHaveBeenCalled();
  });

  it("shares a single reconnect attempt across concurrent transport failures", async () => {
    let firstCallCount = 0;
    const firstSession = createSessionStub(async () => {
      firstCallCount += 1;
      throw transportError("EPIPE");
    });
    const secondSession = createSessionStub(vi.fn().mockResolvedValue("ok"));
    const connect = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);

    const session = await createSelfHealingMcpSession({ connect });

    const [firstResult, secondResult] = await Promise.all([
      session.executeSql("SELECT 1"),
      session.executeSql("SELECT 2"),
    ]);

    expect(firstResult).toBe("ok");
    expect(secondResult).toBe("ok");
    expect(firstCallCount).toBe(2);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(firstSession.close).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting reconnect attempts", async () => {
    const failingSession = createSessionStub(
      vi.fn().mockRejectedValue(transportError("ECONNRESET")),
    );
    const connect = vi.fn().mockResolvedValue(failingSession);

    const session = await createSelfHealingMcpSession({
      connect,
      maxReconnectAttempts: 1,
    });

    await expect(session.executeSql("SELECT 1")).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe("computeReconnectDelayMs", () => {
  it("returns zero when base delay is zero", () => {
    expect(computeReconnectDelayMs(1, { baseDelayMs: 0, maxDelayMs: 5000 })).toBe(0);
    expect(computeReconnectDelayMs(3, { baseDelayMs: 0, maxDelayMs: 5000 })).toBe(0);
  });

  it("applies exponential backoff capped at maxDelayMs", () => {
    expect(computeReconnectDelayMs(1, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(250);
    expect(computeReconnectDelayMs(2, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(500);
    expect(computeReconnectDelayMs(3, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(1000);
    expect(computeReconnectDelayMs(5, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(4000);
    expect(computeReconnectDelayMs(6, { baseDelayMs: 250, maxDelayMs: 5000 })).toBe(5000);
  });
});

describe("createSelfHealingMcpSession backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for baseDelayMs before reconnecting after a transport failure", async () => {
    const firstSession = createSessionStub(
      vi.fn().mockRejectedValueOnce(transportError("ECONNRESET")),
    );
    const secondSession = createSessionStub(
      vi.fn().mockResolvedValue([{ id: 1 }]),
    );
    const connect = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);
    const onReconnect = vi.fn();

    const sessionPromise = createSelfHealingMcpSession({
      connect,
      reconnectBackoff: { baseDelayMs: 250, maxDelayMs: 5000 },
      onReconnect,
    });
    await vi.runAllTimersAsync();
    const session = await sessionPromise;

    const executePromise = session.executeSql("SELECT 1");
    await vi.advanceTimersByTimeAsync(249);
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await executePromise;

    expect(result).toEqual([{ id: 1 }]);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onReconnect).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 250,
      error: expect.objectContaining({ code: "ECONNRESET" }),
    });
  });

  it("reconnects immediately when baseDelayMs is zero", async () => {
    const firstSession = createSessionStub(
      vi.fn().mockRejectedValueOnce(transportError("ECONNRESET")),
    );
    const secondSession = createSessionStub(
      vi.fn().mockResolvedValue("ok"),
    );
    const connect = vi.fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession);

    const session = await createSelfHealingMcpSession({
      connect,
      reconnectBackoff: { baseDelayMs: 0, maxDelayMs: 5000 },
    });

    const result = await session.executeSql("SELECT 1");

    expect(result).toBe("ok");
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("uses capped exponential delay on subsequent reconnect attempts", async () => {
    const failingSession = createSessionStub(
      vi.fn().mockRejectedValue(transportError("ECONNRESET")),
    );
    const connect = vi.fn().mockResolvedValue(failingSession);
    const onReconnect = vi.fn();

    const session = await createSelfHealingMcpSession({
      connect,
      maxReconnectAttempts: 2,
      reconnectBackoff: { baseDelayMs: 250, maxDelayMs: 300 },
      onReconnect,
    });

    const executePromise = session.executeSql("SELECT 1");
    const settled = executePromise.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.error).toMatchObject({ code: "ECONNRESET" });
    }

    expect(onReconnect).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      delayMs: 250,
      error: expect.objectContaining({ code: "ECONNRESET" }),
    });
    expect(onReconnect).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      delayMs: 300,
      error: expect.objectContaining({ code: "ECONNRESET" }),
    });
    expect(connect).toHaveBeenCalledTimes(3);
  });
});
