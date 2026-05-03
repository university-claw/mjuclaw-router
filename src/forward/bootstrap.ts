import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

// `openclaw agent`/`openclaw cron` 등 CLI는 ~/.openclaw/openclaw.json 의
// gateway 섹션을 보고 어디로 연결할지 결정한다. router는 자체 gateway를 띄우지
// 않고 mjuclaw-agent 의 gateway에 remote로 붙는 클라이언트 역할이라
// `gateway.mode: remote` + `gateway.remote.url|token` 만 적힌 최소 config가 필요하다.
//
// 이 함수를 startup에서 한 번 호출해 config를 기록한다. 같은 값이면 idempotent.
export async function ensureOpenClawClientConfig(
  config: Pick<Config, "OPENCLAW_GATEWAY_URL" | "OPENCLAW_GATEWAY_TOKEN">,
  logger: Logger
): Promise<void> {
  const home = os.homedir();
  const configDir = path.join(home, ".openclaw");
  const configPath = path.join(configDir, "openclaw.json");

  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  const desired: Record<string, unknown> = {
    meta: { lastTouchedVersion: "router-mvp1" },
    gateway: {
      mode: "remote",
      remote: {
        url: config.OPENCLAW_GATEWAY_URL,
        transport: "direct",
        ...(config.OPENCLAW_GATEWAY_TOKEN
          ? { token: config.OPENCLAW_GATEWAY_TOKEN }
          : {}),
      },
    },
  };

  let existing: string | null = null;
  try {
    existing = await fs.readFile(configPath, "utf-8");
  } catch {
    // not yet present — proceed to write
  }

  const desiredJson = JSON.stringify(desired, null, 2);
  if (existing && existing.trim() === desiredJson.trim()) {
    logger.debug({ configPath }, "openclaw client config 변경 없음");
    return;
  }

  const tmpPath = `${configPath}.tmp`;
  await fs.writeFile(tmpPath, desiredJson, { mode: 0o600 });
  await fs.rename(tmpPath, configPath);
  logger.info({ configPath }, "openclaw client config 생성/갱신");
}
