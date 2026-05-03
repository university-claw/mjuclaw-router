import { execa } from "execa";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type OnboardStatus = {
  authenticated: boolean;
  studentId?: string;
  raw?: unknown;
};

export class OnboardingStatusChecker {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  appDirFor(discordUserId: string): string {
    return `${this.config.USER_DATA_ROOT}/${discordUserId}`;
  }

  async check(discordUserId: string): Promise<OnboardStatus> {
    const appDir = this.appDirFor(discordUserId);
    try {
      const { stdout } = await execa(
        this.config.MJU_BIN,
        ["--app-dir", appDir, "--format", "json", "auth", "status"],
        { timeout: 15_000, reject: false }
      );
      const parsed = this.parseStdout(stdout);
      const authenticated = this.extractAuthenticated(parsed);
      const studentId = this.extractStudentId(parsed);
      return {
        authenticated,
        ...(studentId !== undefined ? { studentId } : {}),
        raw: parsed,
      };
    } catch (err) {
      this.logger.warn(
        { err, discordUserId },
        "mju auth status 호출 실패, 안전하게 미온보딩으로 처리"
      );
      return { authenticated: false };
    }
  }

  private parseStdout(stdout: string): unknown {
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

  // mju-cli `auth status` 출력 스키마 (2026.4 기준):
  //   { appDataDir, profileFile, sessionFile, credentialServiceName,
  //     profileExists: boolean, passwordStored: boolean, sessionFileExists: boolean }
  // 온보딩 완료 판정 = profile + 시스템 keychain 비밀번호 모두 존재.
  // 세션 파일은 만료되어 재발급될 수 있으므로 판정에서 제외.
  private extractAuthenticated(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== "object") return false;
    const obj = parsed as Record<string, unknown>;
    const profileExists = obj.profileExists === true;
    const passwordStored = obj.passwordStored === true;
    return profileExists && passwordStored;
  }

  private extractStudentId(parsed: unknown): string | undefined {
    if (!parsed || typeof parsed !== "object") return undefined;
    const obj = parsed as Record<string, unknown>;
    const candidates = ["studentId", "student_id", "userId", "id", "username"];
    for (const key of candidates) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  }
}
