import { mkdtemp, rm } from "node:fs/promises";
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
});
