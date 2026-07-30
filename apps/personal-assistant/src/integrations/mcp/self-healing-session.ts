import type { SqlSession } from "../../ports/sql-session.js";
import { isMcpTransportError } from "./transport-errors.js";

export type ReconnectBackoffOptions = {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
};

export type SelfHealingMcpSessionOptions = {
  connect: () => Promise<SqlSession>;
  maxReconnectAttempts?: number;
  reconnectBackoff?: ReconnectBackoffOptions;
  onReconnect?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

export const computeReconnectDelayMs = (
  reconnectAttempt: number,
  options: ReconnectBackoffOptions,
): number => {
  const { baseDelayMs, maxDelayMs, multiplier = 2 } = options;

  if (baseDelayMs <= 0 || reconnectAttempt <= 0) {
    return 0;
  }

  const delay = baseDelayMs * multiplier ** (reconnectAttempt - 1);
  return Math.min(maxDelayMs, delay);
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const createSelfHealingMcpSession = async (
  options: SelfHealingMcpSessionOptions,
): Promise<SqlSession> => {
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 1;
  const reconnectBackoff = options.reconnectBackoff ?? { baseDelayMs: 0, maxDelayMs: 0 };
  let session: SqlSession | undefined;
  let reconnecting: Promise<SqlSession> | undefined;

  const establishSession = async (): Promise<SqlSession> => {
    if (reconnecting) {
      return reconnecting;
    }

    if (!session) {
      session = await options.connect();
    }

    return session;
  };

  const resetAndConnect = async (
    reconnectAttempt: number,
    error: unknown,
  ): Promise<SqlSession> => {
    if (reconnecting) {
      return reconnecting;
    }

    reconnecting = (async () => {
      const delayMs = computeReconnectDelayMs(reconnectAttempt, reconnectBackoff);
      options.onReconnect?.({ attempt: reconnectAttempt, delayMs, error });

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      try {
        if (session) {
          await session.close().catch(() => undefined);
        }
      } finally {
        session = undefined;
      }

      session = await options.connect();
      return session;
    })();

    try {
      return await reconnecting;
    } finally {
      reconnecting = undefined;
    }
  };

  const executeSql = async <T = unknown>(sql: string): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxReconnectAttempts; attempt++) {
      try {
        const activeSession = await establishSession();
        return await activeSession.executeSql<T>(sql);
      } catch (error) {
        lastError = error;

        if (!isMcpTransportError(error) || attempt >= maxReconnectAttempts) {
          throw error;
        }

        await resetAndConnect(attempt + 1, error);
      }
    }

    throw lastError;
  };

  const close = async (): Promise<void> => {
    if (reconnecting) {
      await reconnecting.catch(() => undefined);
    }

    if (!session) {
      return;
    }

    await session.close();
    session = undefined;
  };

  await establishSession();

  return { executeSql, close };
};
