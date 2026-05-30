import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import { AcademicPlanningForwarder } from "../src/forward/academic-planning.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

const discordUserId = "415349075274104832";
const mockedExeca = vi.mocked(execa);

function config(userDataRoot: string): Config {
  return {
    DISCORD_BOT_TOKEN: "test-token",
    USER_DATA_ROOT: userDataRoot,
    OPENCLAW_GATEWAY_URL: "ws://mjuclaw-agent:18789",
    OPENCLAW_BIN: "openclaw",
    MJU_BIN: "mju",
    MJU_TIMETABLE_PLANNER_BIN: "mju-timetable-planner",
    MJU_GRADUATION_ROADMAP_BIN: "mju-graduation-roadmap",
    ACADEMIC_PLANNING_TIMEOUT_MS: 600_000,
    HTTP_PORT: 3100,
    HTTP_BIND_HOST: "0.0.0.0",
    HTTP_AUTH_TOKEN: "0123456789abcdef",
    VIEW_SERVER_URL: "http://mjuclaw-agent:3001",
    CLASSIFIER_ENABLED: true,
    CLASSIFIER_URL: "http://classifier:3200",
    CLASSIFIER_AUTH_TOKEN: "",
    CLASSIFIER_TIMEOUT_MS: 2500,
    LOG_LEVEL: "fatal",
    NODE_ENV: "production",
  };
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("AcademicPlanningForwarder", () => {
  let userDataRoot: string;

  beforeEach(async () => {
    userDataRoot = await mkdtemp(join(tmpdir(), "academic-planning-forwarder-"));
    vi.clearAllMocks();
    mockedExeca.mockResolvedValue({
      stdout: JSON.stringify({ items: [] }),
      stderr: "",
      exitCode: 0,
    } as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ url: "http://view.local/abc" }),
      })
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(userDataRoot, { recursive: true, force: true });
  });

  it("runs the timetable planner helper directly with an explicit year and term", async () => {
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "2026년 1학기 시간표 설계 웹뷰 보여줘",
    });

    expect(result).toMatchObject({
      handled: true,
      ok: true,
      intent: "timetable-planner",
    });
    expect(mockedExeca).toHaveBeenCalledWith(
      "mju-timetable-planner",
      [discordUserId, "--year", "2026", "--term-code", "10", "--format", "json"],
      expect.objectContaining({
        timeout: 600_000,
        env: { VIEW_API_URL: "http://mjuclaw-agent:3001/api/view" },
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://mjuclaw-agent:3001/api/view",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("reissues an expired-link request through the last deterministic academic-planning action", async () => {
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    await forwarder.tryForward({
      discordUserId,
      message: "2026-1 시간표 짜줘",
    });
    await forwarder.tryForward({
      discordUserId,
      message: "링크가 만료되었다는데?",
    });

    expect(mockedExeca).toHaveBeenCalledTimes(2);
    expect(mockedExeca).toHaveBeenLastCalledWith(
      "mju-timetable-planner",
      [discordUserId, "--year", "2026", "--term-code", "10", "--format", "json"],
      expect.any(Object)
    );
  });

  it("uses the graduation roadmap helper without OpenClaw", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ viewUrl: "http://view.local/graduation" }),
      stderr: "",
      exitCode: 0,
    } as never);
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "졸업로드맵 보여줘",
    });

    expect(result).toMatchObject({
      handled: true,
      ok: true,
      intent: "graduation-roadmap",
    });
    expect(mockedExeca).toHaveBeenCalledWith(
      "mju-graduation-roadmap",
      [discordUserId, "--format", "json"],
      expect.any(Object)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves unrelated requests on the normal OpenClaw path", async () => {
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "오늘 학식 알려줘",
    });

    expect(result).toEqual({ handled: false });
    expect(mockedExeca).not.toHaveBeenCalled();
  });

  it("returns the deepest helper diagnostic stage when the helper exits non-zero", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: [
        "ACADEMIC_PLANNING_DIAG stage=msi detail=grade_history_read mode=timetable",
        "ACADEMIC_PLANNING_DIAG stage=msi detail=grade_history_login_password_change_cancel_still_interstitial mode=timetable",
        "ERR: failed to read MSI grade history for academic planning",
      ].join("\n"),
      exitCode: 1,
    } as never);
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "시간표 설계",
    });

    expect(result).toMatchObject({
      handled: true,
      ok: false,
      intent: "timetable-planner",
      reason: "academic_planning_exit_1.msi.grade_history_login_password_change_cancel_still_interstitial",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "academic_planning_exit_1.msi.grade_history_login_password_change_cancel_still_interstitial",
        helperStage: "msi",
        helperDetail: "grade_history_login_password_change_cancel_still_interstitial",
        helperMode: "timetable",
      }),
      expect.any(String)
    );
  });

  it("returns public-data helper diagnostics after MSI context succeeds", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: [
        "ACADEMIC_PLANNING_DIAG stage=msi detail=grade_history_read mode=graduation-roadmap",
        "ACADEMIC_PLANNING_DIAG stage=context detail=extract_from_msi mode=graduation-roadmap",
        "ACADEMIC_PLANNING_DIAG stage=public_data detail=academic_planning_run mode=graduation-roadmap",
        "ACADEMIC_PLANNING_DIAG stage=public_data detail=academic_planning_db_table_missing mode=graduation-roadmap",
        "ERR: failed to build academic planning payload",
      ].join("\n"),
      exitCode: 1,
    } as never);
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "졸업로드맵",
    });

    expect(result).toMatchObject({
      handled: true,
      ok: false,
      intent: "graduation-roadmap",
      reason: "academic_planning_exit_1.public_data.academic_planning_db_table_missing",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "academic_planning_exit_1.public_data.academic_planning_db_table_missing",
        helperStage: "public_data",
        helperDetail: "academic_planning_db_table_missing",
        helperMode: "graduation-roadmap",
      }),
      expect.any(String)
    );
  });

  it("falls back to legacy helper stderr patterns when no structured diagnostic is present", async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "ERR: failed to read MSI grade history for academic planning",
      exitCode: 1,
    } as never);
    const forwarder = new AcademicPlanningForwarder(config(userDataRoot), logger);

    const result = await forwarder.tryForward({
      discordUserId,
      message: "졸업로드맵 보여줘",
    });

    expect(result).toMatchObject({
      handled: true,
      ok: false,
      intent: "graduation-roadmap",
      reason: "academic_planning_exit_1.msi.grade_history_read_failed",
    });
  });

  it("keeps the bundled helper wired for deeper runtime diagnostics", async () => {
    const helper = await readFile(new URL("../bin/mju-academic-planning", import.meta.url), "utf8");

    expect(helper).toContain("classify_grade_history_failure");
    expect(helper).toContain("last_msi_diagnostic");
    expect(helper).toContain("grade_history_password_change_interstitial_detected");
    expect(helper).toContain("grade_history_{detail}");
    expect(helper).not.toContain('"snapshots" / "msi-main.html"');
    expect(helper).toContain("classify_public_data_failure");
    expect(helper).toContain("academic_planning_db_table_missing");
    expect(helper).toContain("> \"$MJU_NEWS_STDOUT\" 2> \"$MJU_NEWS_STDERR\"");
    expect(helper).toContain("cat \"$MJU_NEWS_STDOUT\"");
  });
});
