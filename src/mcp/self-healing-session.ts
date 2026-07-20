import { isMcpTransportError } from "./transport-errors.js";

export type McpSessionLike = {
  executeSql<T = unknown>(sql: string): Promise<T>;
  close(): Promise<void>;
};

export type SelfHealingMcpSessionOptions = {
  connect: () => Promise<McpSessionLike>;
  maxReconnectAttempts?: number;
  onReconnect?: (info: { attempt: number; error: unknown }) => void;
};

export const createSelfHealingMcpSession = async (
  options: SelfHealingMcpSessionOptions,
): Promise<McpSessionLike> => {
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 1;
  let session: McpSessionLike | undefined;
  let reconnecting: Promise<McpSessionLike> | undefined;

  const establishSession = async (): Promise<McpSessionLike> => {
    if (reconnecting) {
      return reconnecting;
    }

    if (!session) {
      session = await options.connect();
    }

    return session;
  };

  const resetAndConnect = async (): Promise<McpSessionLike> => {
    if (reconnecting) {
      return reconnecting;
    }

    reconnecting = (async () => {
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

        options.onReconnect?.({ attempt: attempt + 1, error });
        await resetAndConnect();
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
