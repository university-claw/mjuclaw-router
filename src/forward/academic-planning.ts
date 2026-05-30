import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execa } from "execa";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import {
  type AcademicPlanningIntent,
  type AcademicPlanningTerm,
  classifyAcademicPlanningIntent,
  extractAcademicPlanningTerm,
  isExpiredWebviewRefreshRequest,
} from "./academic-planning-routing.js";

type LastAcademicPlanningView = {
  intent: AcademicPlanningIntent;
  term?: AcademicPlanningTerm;
  updatedAt: string;
};

export type AcademicPlanningResult =
  | { handled: false }
  | { handled: true; ok: true; text: string; intent: AcademicPlanningIntent }
  | {
      handled: true;
      ok: false;
      reason: string;
      intent: AcademicPlanningIntent;
    };

export class AcademicPlanningForwarder {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  async tryForward(params: {
    discordUserId: string;
    message: string;
  }): Promise<AcademicPlanningResult> {
    const directIntent = classifyAcademicPlanningIntent(params.message);
    const directTerm = extractAcademicPlanningTerm(params.message);
    const last =
      directIntent === null && isExpiredWebviewRefreshRequest(params.message)
        ? await this.loadLast(params.discordUserId)
        : null;
    const intent = directIntent ?? last?.intent ?? null;
    const term = directTerm ?? last?.term;

    if (intent === null) return { handled: false };

    const helperParams = {
      discordUserId: params.discordUserId,
      intent,
      ...(term ? { term } : {}),
    };
    const result = await this.runHelper(helperParams);
    if (!result.ok) return { handled: true, ok: false, reason: result.reason, intent };

    await this.saveLast(params.discordUserId, {
      intent,
      ...(term ? { term } : {}),
    });
    return {
      handled: true,
      ok: true,
      intent,
      text: this.successText(intent, result.viewUrl),
    };
  }

  private async runHelper(params: {
    discordUserId: string;
    intent: AcademicPlanningIntent;
    term?: AcademicPlanningTerm;
  }): Promise<{ ok: true; viewUrl: string } | { ok: false; reason: string }> {
    const command =
      params.intent === "timetable-planner"
        ? this.config.MJU_TIMETABLE_PLANNER_BIN
        : this.config.MJU_GRADUATION_ROADMAP_BIN;
    const args = [params.discordUserId, "--format", "json"];
    if (params.intent === "timetable-planner" && params.term) {
      args.splice(1, 0, "--year", params.term.year, "--term-code", params.term.termCode);
    }

    try {
      const { stdout, stderr, exitCode } = await execa(command, args, {
        timeout: this.config.ACADEMIC_PLANNING_TIMEOUT_MS,
        reject: false,
        env: {
          VIEW_API_URL: `${this.config.VIEW_SERVER_URL.replace(/\/+$/u, "")}/api/view`,
        },
      });

      if (exitCode !== 0) {
        const reason = `academic_planning_exit_${exitCode ?? "unknown"}`;
        this.logger.warn(
          {
            discordUserId: params.discordUserId,
            intent: params.intent,
            command,
            reason,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          },
          "deterministic academic-planning helper 실패"
        );
        return { ok: false, reason };
      }

      const parsed = this.tryParseJson(stdout);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        this.logger.warn(
          {
            discordUserId: params.discordUserId,
            intent: params.intent,
            command,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          },
          "deterministic academic-planning helper 응답이 JSON이 아님"
        );
        return { ok: false, reason: "academic_planning_non_json" };
      }

      const embeddedViewUrl = (parsed as Record<string, unknown>).viewUrl;
      if (typeof embeddedViewUrl === "string" && embeddedViewUrl.trim().length > 0) {
        return { ok: true, viewUrl: embeddedViewUrl };
      }

      const createdView = await this.createView(params.intent, parsed);
      if (!createdView.ok) {
        this.logger.warn(
          {
            discordUserId: params.discordUserId,
            intent: params.intent,
            command,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          },
          "deterministic academic-planning view 생성 실패"
        );
        return { ok: false, reason: createdView.reason };
      }

      return { ok: true, viewUrl: createdView.viewUrl };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "TimeoutError"
          ? "academic_planning_timeout"
          : "academic_planning_exception";
      this.logger.error(
        { err, discordUserId: params.discordUserId, intent: params.intent, command, reason },
        "deterministic academic-planning helper 예외"
      );
      return { ok: false, reason };
    }
  }

  private successText(intent: AcademicPlanningIntent, viewUrl: string): string {
    if (intent === "timetable-planner") {
      return `시간표 설계 웹뷰를 열었어요.\n\n[시간표 설계 웹뷰](${viewUrl})`;
    }
    return `졸업 로드맵 웹뷰를 열었어요.\n\n[졸업 로드맵 상세 보기](${viewUrl})`;
  }

  private async createView(
    intent: AcademicPlanningIntent,
    rawData: unknown
  ): Promise<{ ok: true; viewUrl: string } | { ok: false; reason: string }> {
    const url = `${this.config.VIEW_SERVER_URL.replace(/\/+$/u, "")}/api/view`;
    const dataType = intent === "timetable-planner" ? "timetable-planner" : "graduation";
    const title = intent === "timetable-planner" ? "시간표 설계" : "졸업 로드맵";

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataType,
          title,
          summary: "",
          rawData,
          aiResponse: "",
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return { ok: false, reason: `academic_planning_view_http_${response.status}` };
      }

      const payload = await response.json() as Record<string, unknown>;
      const viewUrl = payload.url;
      if (typeof viewUrl !== "string" || viewUrl.trim().length === 0) {
        return { ok: false, reason: "academic_planning_view_missing_url" };
      }
      return { ok: true, viewUrl };
    } catch {
      return { ok: false, reason: "academic_planning_view_post_failed" };
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

  private lastPath(discordUserId: string): string {
    return join(
      this.config.USER_DATA_ROOT,
      discordUserId,
      ".router-academic-planning-last.json"
    );
  }

  private async loadLast(discordUserId: string): Promise<LastAcademicPlanningView | null> {
    try {
      const raw = await readFile(this.lastPath(discordUserId), "utf8");
      const parsed = JSON.parse(raw) as Partial<LastAcademicPlanningView>;
      if (
        parsed.intent !== "timetable-planner" &&
        parsed.intent !== "graduation-roadmap"
      ) {
        return null;
      }
      if (parsed.term && !this.isTerm(parsed.term)) return null;
      return {
        intent: parsed.intent,
        ...(parsed.term ? { term: parsed.term } : {}),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    } catch {
      return null;
    }
  }

  private async saveLast(
    discordUserId: string,
    value: Omit<LastAcademicPlanningView, "updatedAt">
  ): Promise<void> {
    const path = this.lastPath(discordUserId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        {
          ...value,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf8"
    );
  }

  private isTerm(value: unknown): value is AcademicPlanningTerm {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.year === "string" &&
      (record.termCode === "10" || record.termCode === "20")
    );
  }
}
