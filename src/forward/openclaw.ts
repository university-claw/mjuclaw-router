import { execa } from "execa";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type ForwardPayload = {
  text?: string;
  components?: unknown;
  raw: unknown;
};

export type ForwardResult =
  | { ok: true; payloads: ForwardPayload[]; raw: unknown }
  | { ok: false; reason: string; raw?: unknown };

export class OpenClawForwarder {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  async forward(params: {
    discordUserId: string;
    message: string;
    sessionLabel?: string;
  }): Promise<ForwardResult> {
    // gateway URL/token은 startup에서 ~/.openclaw/openclaw.json (gateway.remote)
    // 으로 부트스트랩되어 있으므로 CLI에 따로 넘기지 않는다 (`openclaw agent`는
    // --url/--token 옵션을 받지 않는다).
    //
    // ⚠️ 사용자 격리 (2026-05-03 데이터 누출 사고 fix):
    // - `--to` 만 넘기면 openclaw가 default agent label
    //   ("agent:main:discord:direct:<env DISCORD_USER_ID>") 한 개로 모든 메시지를
    //   collapse → 모든 사용자가 같은 session에서 LLM 메모리 공유 → 첫 사용자의
    //   컨텍스트(학번, 듣는 수업 등)가 다음 사용자에게 누출 (재현/검증 완료).
    // - `--session-id`로 사용자별 unique 값을 명시하면 session 분리됨 (검증 완료).
    // - LLM에게 현재 turn 사용자 ID를 알리기 위해 message 본문 첫 줄에 명시 prefix.
    //   BOOTSTRAP의 `{DISCORD_USER_ID}` placeholder는 이 prefix의 ID로 LLM이 채운다.
    const sessionId = `discord-${params.discordUserId}`;
    const taggedMessage =
      `[사용자ID: ${params.discordUserId}]\n` +
      `위 ID를 모든 mju-cli 호출의 \`--app-dir /data/users/{DISCORD_USER_ID}\` 와 ` +
      `helper 인자(mju-attendance-alert/mju-news-alert/mju-onboarding-survey)의 ` +
      `{DISCORD_USER_ID} 자리에 정확히 사용하세요. 다른 ID 사용 금지.\n\n` +
      params.message;

    const args = [
      "agent",
      "--session-id",
      sessionId,
      "--to",
      params.discordUserId,
      "--channel",
      "discord",
      "--message",
      taggedMessage,
      "--json",
    ];

    try {
      const { stdout, stderr, exitCode } = await execa(
        this.config.OPENCLAW_BIN,
        args,
        { timeout: 600_000, reject: false }
      );

      if (exitCode !== 0) {
        const reason = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
        this.logger.warn(
          { discordUserId: params.discordUserId, exitCode, reason },
          "openclaw agent forward 실패"
        );
        return { ok: false, reason };
      }

      const parsed = this.tryParseJson(stdout);
      if (!parsed) {
        return {
          ok: false,
          reason: "openclaw agent 응답이 JSON이 아님",
          raw: stdout,
        };
      }

      const payloads = this.extractPayloads(parsed);
      return { ok: true, payloads, raw: parsed };
    } catch (err) {
      this.logger.error(
        { err, discordUserId: params.discordUserId },
        "openclaw agent 호출 예외"
      );
      return { ok: false, reason: "openclaw agent 호출 실패" };
    }
  }

  private tryParseJson(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      const firstBrace = trimmed.indexOf("{");
      if (firstBrace > 0) {
        try {
          return JSON.parse(trimmed.slice(firstBrace));
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  private extractPayloads(parsed: unknown): ForwardPayload[] {
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    const rawPayloads = result?.payloads;
    if (!Array.isArray(rawPayloads)) return [];

    return rawPayloads
      .map((p): ForwardPayload | null => {
        if (!p || typeof p !== "object") return null;
        const r = p as Record<string, unknown>;
        const text = typeof r.text === "string" ? r.text : undefined;
        const components = r.components ?? r.interactive ?? undefined;
        if (text === undefined && components === undefined) return null;
        return {
          ...(text !== undefined ? { text } : {}),
          ...(components !== undefined ? { components } : {}),
          raw: p,
        };
      })
      .filter((x): x is ForwardPayload => x !== null);
  }
}
