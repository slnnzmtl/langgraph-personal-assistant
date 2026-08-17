import path from "node:path";
import os from "node:os";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireProcessLock,
  ProcessLockError,
} from "@personal-assistant/supervisor-framework";

const lockDir = path.join(process.cwd(), ".tmp", `process-lock-${process.pid}`);

const lockPath = (name: string): string => path.join(lockDir, `${name}.lock`);

const writeLockMetadata = async (
  filePath: string,
  metadata: { pid: number; startedAt: string; hostname: string },
): Promise<void> => {
  await mkdir(lockDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(metadata)}\n`, "utf8");
};

afterEach(async () => {
  await Promise.all([
    unlink(lockPath("primary")).catch(() => undefined),
    unlink(lockPath("stale")).catch(() => undefined),
    unlink(lockPath("contended")).catch(() => undefined),
    unlink(lockPath("hostname-stale")).catch(() => undefined),
    unlink(lockPath("pid-reuse")).catch(() => undefined),
  ]);
});

describe("process lock", () => {
  it("creates and releases an exclusive lock file", async () => {
    const filePath = lockPath("primary");
    const lock = await acquireProcessLock({ lockFilePath: filePath });

    await expect(access(filePath)).resolves.toBeUndefined();
    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({ pid: process.pid });

    await lock.release();
    await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a second lock while the first is held", async () => {
    const filePath = lockPath("contended");
    const first = await acquireProcessLock({ lockFilePath: filePath });

    await expect(acquireProcessLock({ lockFilePath: filePath })).rejects.toBeInstanceOf(
      ProcessLockError,
    );

    await first.release();
  });

  it("reclaims a stale lock when the recorded pid is not running", async () => {
    const filePath = lockPath("stale");
    await writeLockMetadata(filePath, {
      pid: 9_999_999,
      startedAt: "1970-01-01T00:00:00.000Z",
      hostname: "stale-host",
    });

    const lock = await acquireProcessLock({ lockFilePath: filePath });
    expect(lock.metadata.pid).toBe(process.pid);

    await lock.release();
  });

  it("reclaims a stale lock when the recorded hostname differs (container recreate)", async () => {
    const filePath = lockPath("hostname-stale");
    await writeLockMetadata(filePath, {
      pid: process.pid,
      startedAt: "1970-01-01T00:00:00.000Z",
      hostname: "previous-container-id",
    });

    const lock = await acquireProcessLock({ lockFilePath: filePath });
    expect(lock.metadata.hostname).toBe(os.hostname());

    await lock.release();
  });

  it("reclaims a stale lock when pid matches but this process never acquired (container restart)", async () => {
    const filePath = lockPath("pid-reuse");
    await writeLockMetadata(filePath, {
      pid: process.pid,
      startedAt: "1970-01-01T00:00:00.000Z",
      hostname: os.hostname(),
    });

    const lock = await acquireProcessLock({ lockFilePath: filePath });
    expect(lock.metadata.pid).toBe(process.pid);
    expect(lock.metadata.startedAt).not.toBe("1970-01-01T00:00:00.000Z");

    await lock.release();
  });
});
