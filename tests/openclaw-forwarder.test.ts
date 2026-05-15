import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import { OpenClawForwarder } from "../src/forward/openclaw.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

const config: Config = {
  DISCORD_BOT_TOKEN: "test-token",
  USER_DATA_ROOT: "/data/users",
  OPENCLAW_GATEWAY_URL: "ws://mjuclaw-agent:18789",
  OPENCLAW_BIN: "openclaw",
  MJU_BIN: "mju",
  HTTP_PORT: 3100,
  HTTP_BIND_HOST: "0.0.0.0",
  HTTP_AUTH_TOKEN: "0123456789abcdef",
  VIEW_SERVER_URL: "http://mjuclaw-agent:3001",
  CLASSIFIER_ENABLED: false,
  CLASSIFIER_URL: "",
  CLASSIFIER_AUTH_TOKEN: "",
  CLASSIFIER_TIMEOUT_MS: 2500,
  LOG_LEVEL: "fatal",
  NODE_ENV: "test" as Config["NODE_ENV"],
};

const logger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function messageArg(args: unknown[]): string {
  const index = (args as string[]).indexOf("--message");
  return (args as string[])[index + 1]!;
}

function sessionIdArg(args: unknown[]): string {
  const index = (args as string[]).indexOf("--session-id");
  return (args as string[])[index + 1]!;
}

describe("OpenClawForwarder session isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes only an explicit per-user session id and does not pass --to", async () => {
    const execaMock = vi.mocked(execa);
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({ result: { payloads: [] } }),
      stderr: "",
      exitCode: 0,
    } as never);

    const forwarder = new OpenClawForwarder(config, logger as never);
    const result = await forwarder.forward({
      discordUserId: "415349075274104832",
      message: "안녕",
    });

    expect(result.ok).toBe(true);
    expect(execaMock).toHaveBeenCalledTimes(1);

    const [command, args] = execaMock.mock.calls[0]!;
    expect(command).toBe("openclaw");
    expect(args).not.toContain("--to");
    expect(sessionIdArg(args as unknown[])).toBe("discord-415349075274104832");

    const taggedMessage = messageArg(args as unknown[]);
    expect(taggedMessage).toContain("[현재 사용자 컨텍스트]");
    expect(taggedMessage).toContain('- discordUserId: "415349075274104832"');
    expect(taggedMessage).toContain("[/현재 사용자 컨텍스트]");
    expect(taggedMessage).toContain(
      "`--app-dir`은 `/data/users/415349075274104832`만 사용하세요"
    );
    expect(taggedMessage).toContain(
      "사용자 이름/호칭은 이 컨텍스트에서 추측하지 말고"
    );
    expect(taggedMessage).not.toContain("- preferredName:");
    expect(taggedMessage).not.toContain("[선호호칭:");
    expect(taggedMessage).toContain("안녕");
  });

  it("keeps session ids and app-dir context distinct across users", async () => {
    const execaMock = vi.mocked(execa);
    execaMock.mockResolvedValue({
      stdout: JSON.stringify({ result: { payloads: [] } }),
      stderr: "",
      exitCode: 0,
    } as never);

    const forwarder = new OpenClawForwarder(config, logger as never);
    await forwarder.forward({
      discordUserId: "111111111111111111",
      message: "첫 번째 사용자",
    });
    await forwarder.forward({
      discordUserId: "222222222222222222",
      message: "두 번째 사용자",
    });

    expect(execaMock).toHaveBeenCalledTimes(2);

    const firstArgs = execaMock.mock.calls[0]![1] as unknown[];
    const secondArgs = execaMock.mock.calls[1]![1] as unknown[];

    expect(sessionIdArg(firstArgs)).toBe("discord-111111111111111111");
    expect(sessionIdArg(secondArgs)).toBe("discord-222222222222222222");
    expect(messageArg(firstArgs)).toContain("/data/users/111111111111111111");
    expect(messageArg(secondArgs)).toContain("/data/users/222222222222222222");
    expect(messageArg(firstArgs)).not.toContain("222222222222222222");
    expect(messageArg(secondArgs)).not.toContain("111111111111111111");
  });

  it("does not return or log raw subprocess output on OpenClaw failure", async () => {
    const execaMock = vi.mocked(execa);
    execaMock.mockResolvedValue({
      stdout: "raw stdout with user message",
      stderr: "raw stderr with profile data",
      exitCode: 7,
    } as never);

    const forwarder = new OpenClawForwarder(config, logger as never);
    const result = await forwarder.forward({
      discordUserId: "415349075274104832",
      message: "민감한 사용자 메시지",
    });

    expect(result).toEqual({ ok: false, reason: "openclaw_exit_7" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: "415349075274104832",
        exitCode: 7,
        reason: "openclaw_exit_7",
        stdoutLength: "raw stdout with user message".length,
        stderrLength: "raw stderr with profile data".length,
      }),
      "openclaw agent forward 실패"
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      "raw stdout with user message"
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      "raw stderr with profile data"
    );
  });
});
