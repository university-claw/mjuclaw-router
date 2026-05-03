import pino from "pino";

import type { Config } from "./config.js";

export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">) {
  const isDev = config.NODE_ENV === "development";
  return pino({
    level: config.LOG_LEVEL,
    base: { service: "mjuclaw-router" },
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l" },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
