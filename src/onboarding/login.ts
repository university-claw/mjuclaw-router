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
        // 온보딩 후속 부가 효과 (출석 알림 cron 등록 + 공지 알림 설문 Poll 2건 발사)
        // 트리거. fire-and-forget — login 응답 latency를 늘리지 않는다. agent의
        // view-server가 60초 timeout 안에서 mju-attendance-alert subscribe +
        // mju-onboarding-survey start 를 실행하고, helper들은 router HTTP로 Discord
        // 작업을 다시 위임한다 (agent는 Discord 토큰을 갖지 않으므로 직접 호출 불가).
        void this.triggerPostLogin(discordUserId);
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

  // agent view-server의 /internal/onboarding-postlogin 호출. 실패해도 login 자체는
  // 성공 응답이 이미 나갔으므로 logger.warn 만 남기고 swallow.
  private async triggerPostLogin(discordUserId: string): Promise<void> {
    const url = `${this.config.VIEW_SERVER_URL}/internal/onboarding-postlogin`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.HTTP_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ discordUserId }),
        // helper 60s timeout + 안전 마진. agent가 죽었거나 view-server 미응답이면
        // 90초 후 abort.
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.warn(
          { discordUserId, status: res.status, body: text.slice(0, 500) },
          "post-login 트리거 비-200 응답"
        );
        return;
      }
      const json = (await res.json().catch(() => null)) as unknown;
      this.logger.info(
        { discordUserId, result: json },
        "post-login 트리거 완료"
      );
    } catch (err) {
      this.logger.warn(
        { discordUserId, err: String(err) },
        "post-login 트리거 호출 예외"
      );
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
