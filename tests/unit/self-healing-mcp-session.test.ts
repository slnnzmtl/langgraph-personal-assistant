import { describe, expect, it, vi } from "vitest";

import { createSelfHealingMcpSession, type McpSessionLike } from "../../src/mcp/self-healing-session.js";

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
