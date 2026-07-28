import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProcessLockMetadata = {
  pid: number;
  startedAt: string;
  hostname: string;
};

export type ProcessLock = {
  release(): Promise<void>;
  metadata: ProcessLockMetadata;
};

export class ProcessLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessLockError";
  }
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }

    return code === "EPERM";
  }
};

const readLockMetadata = async (lockFilePath: string): Promise<ProcessLockMetadata | undefined> => {
  try {
    const raw = await readFile(lockFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProcessLockMetadata>;

    if (typeof parsed.pid !== "number" || typeof parsed.startedAt !== "string") {
      return undefined;
    }

    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : "unknown",
    };
  } catch {
    return undefined;
  }
};

const writeLockFile = async (
  lockFilePath: string,
  metadata: ProcessLockMetadata,
): Promise<void> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(lockFilePath, "wx");
    await writeFile(handle, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    await handle?.close();
  }
};

const removeStaleLockIfNeeded = async (lockFilePath: string): Promise<boolean> => {
  const metadata = await readLockMetadata(lockFilePath);

  if (!metadata) {
    try {
      await unlink(lockFilePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }

      return false;
    }
  }

  if (metadata.pid === process.pid) {
    return false;
  }

  if (!isProcessRunning(metadata.pid)) {
    try {
      await unlink(lockFilePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }

      return false;
    }
  }

  return false;
};

export type AcquireProcessLockOptions = {
  lockFilePath: string;
};

export const acquireProcessLock = async (
  options: AcquireProcessLockOptions,
): Promise<ProcessLock> => {
  await mkdir(path.dirname(options.lockFilePath), { recursive: true });

  const metadata: ProcessLockMetadata = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeLockFile(options.lockFilePath, metadata);

      return {
        metadata,
        release: async () => {
          const current = await readLockMetadata(options.lockFilePath);

          if (current?.pid !== process.pid) {
            return;
          }

          try {
            await unlink(options.lockFilePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const existing = await readLockMetadata(options.lockFilePath);
      const removed = await removeStaleLockIfNeeded(options.lockFilePath);

      if (removed && attempt === 0) {
        continue;
      }

      const holder = existing
        ? `pid ${existing.pid} on ${existing.hostname} since ${existing.startedAt}`
        : "another process";
      throw new ProcessLockError(
        `Process lock already held at ${options.lockFilePath} by ${holder}`,
      );
    }
  }

  throw new ProcessLockError(`Unable to acquire process lock at ${options.lockFilePath}`);
};
