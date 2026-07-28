import path from "node:path";
import { access, readFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireProcessLock,
  ProcessLockError,
} from "@personal-assistant/supervisor-framework";

const lockDir = path.join(process.cwd(), ".tmp", `process-lock-${process.pid}`);

const lockPath = (name: string): string => path.join(lockDir, `${name}.lock`);

afterEach(async () => {
  await Promise.all([
    unlink(lockPath("primary")).catch(() => undefined),
    unlink(lockPath("stale")).catch(() => undefined),
    unlink(lockPath("contended")).catch(() => undefined),
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
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(lockDir, { recursive: true }).then(() =>
        writeFile(
          filePath,
          `${JSON.stringify({
            pid: 9_999_999,
            startedAt: "1970-01-01T00:00:00.000Z",
            hostname: "stale-host",
          })}\n`,
          "utf8",
        ),
      ),
    );

    const lock = await acquireProcessLock({ lockFilePath: filePath });
    expect(lock.metadata.pid).toBe(process.pid);

    await lock.release();
  });
});
