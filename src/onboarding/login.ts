import { execa } from "execa";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type LoginResult =
  | { ok: true; raw?: unknown }
  | { ok: false; reason: string; raw?: unknown };

export class OnboardingLoginRunner {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  appDirFor(discordUserId: string): string {
    return `${this.config.USER_DATA_ROOT}/${discordUserId}`;
  }

  async login(
    discordUserId: string,
    studentId: string,
    password: string
  ): Promise<LoginResult> {
    const appDir = this.appDirFor(discordUserId);
    try {
      const { stdout, stderr, exitCode } = await execa(
        this.config.MJU_BIN,
        [
          "--app-dir",
          appDir,
          "--format",
          "json",
          "auth",
          "login",
          "--id",
          studentId,
          "--password",
          password,
        ],
        { timeout: 90_000, reject: false }
      );

      const parsed = this.tryParseJson(stdout);

      if (exitCode === 0) {
        return { ok: true, raw: parsed ?? stdout };
      }

      const reason =
        this.extractError(parsed) ||
        stderr.trim() ||
        stdout.trim() ||
        "알 수 없는 로그인 오류";

      this.logger.warn(
        { discordUserId, exitCode, reason },
        "mju auth login 실패"
      );

      return { ok: false, reason, raw: parsed ?? stdout };
    } catch (err) {
      this.logger.error({ err, discordUserId }, "mju auth login 예외 발생");
      return {
        ok: false,
        reason: "로그인 처리 중 예외가 발생했습니다.",
      };
    }
  }

  private tryParseJson(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  private extractError(parsed: unknown): string | undefined {
    if (!parsed || typeof parsed !== "object") return undefined;
    const obj = parsed as Record<string, unknown>;
    const candidates = ["error", "message", "reason", "detail"];
    for (const key of candidates) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (v && typeof v === "object") {
        const inner = (v as Record<string, unknown>).message;
        if (typeof inner === "string" && inner.length > 0) return inner;
      }
    }
    return undefined;
  }
}
