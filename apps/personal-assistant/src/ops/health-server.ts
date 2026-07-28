import { createServer, type Server } from "node:http";

import type { Logger } from "@personal-assistant/supervisor-framework";

export type HealthServer = {
  port: number;
  close(): Promise<void>;
};

export type CreateHealthServerOptions = {
  port: number;
  isReady: () => boolean;
  logger?: Logger;
};

const HEALTH_PATHS = {
  live: "/health/live",
  ready: "/health/ready",
} as const;

export const createHealthServer = async (
  options: CreateHealthServerOptions,
): Promise<HealthServer> => {
  const logger = options.logger;

  const server: Server = createServer((request, response) => {
    const pathname = request.url?.split("?")[0];

    if (pathname === HEALTH_PATHS.live) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok");
      return;
    }

    if (pathname === HEALTH_PATHS.ready) {
      if (options.isReady()) {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ready");
        return;
      }

      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("not ready");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "0.0.0.0", () => resolve());
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : options.port;

  logger?.info(`Health server listening on :${boundPort}`);

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
};
