import { afterEach, describe, expect, it } from "vitest";

import { createHealthServer } from "../../../src/ops/health-server.js";

describe("health server", () => {
  let closeHealth: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeHealth) {
      await closeHealth();
      closeHealth = undefined;
    }
  });

  it("returns ok for liveness regardless of readiness", async () => {
    const server = await createHealthServer({
      port: 0,
      isReady: () => false,
    });
    closeHealth = server.close;

    const response = await fetch(`http://127.0.0.1:${server.port}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("returns 503 for readiness until the app is ready", async () => {
    let ready = false;
    const server = await createHealthServer({
      port: 0,
      isReady: () => ready,
    });
    closeHealth = server.close;

    const notReady = await fetch(`http://127.0.0.1:${server.port}/health/ready`);
    expect(notReady.status).toBe(503);

    ready = true;
    const readyResponse = await fetch(`http://127.0.0.1:${server.port}/health/ready`);
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.text()).toBe("ready");
  });
});
