import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";
import { MjuClawAgentForwarder } from "../src/forward/agent.js";

const config: Config = {
  DISCORD_BOT_TOKEN: "test-token",
  USER_DATA_ROOT: "/data/users",
  MJU_AGENT_URL: "http://mjuclaw-agent:8000/v1/discord/messages",
  MJU_AGENT_TIMEOUT_MS: 600_000,
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

describe("MjuClawAgentForwarder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts the minimal router-to-agent request schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          payloads: [{ type: "text", text: "오늘 과제는 2개예요." }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const forwarder = new MjuClawAgentForwarder(config, logger as never);
    const result = await forwarder.forward({
      discordUserId: "415349075274104832",
      messageId: "123456789012345678",
      messageText: "오늘 과제 뭐 있어?",
      channelType: "dm",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(config.MJU_AGENT_URL);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      discordUserId: "415349075274104832",
      messageId: "123456789012345678",
      messageText: "오늘 과제 뭐 있어?",
      channelType: "dm",
    });

    if (!result.ok) throw new Error("expected forward success");
    expect(result.payloads).toEqual([
      {
        text: "오늘 과제는 2개예요.",
        raw: { type: "text", text: "오늘 과제는 2개예요." },
      },
    ]);
  });

  it("does not log or return raw response bodies on non-2xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("raw body with sensitive details", { status: 502 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const forwarder = new MjuClawAgentForwarder(config, logger as never);
    const result = await forwarder.forward({
      discordUserId: "415349075274104832",
      messageId: "123456789012345678",
      messageText: "민감한 사용자 메시지",
      channelType: "dm",
    });

    expect(result).toEqual({ ok: false, reason: "agent_http_502" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        discordUserId: "415349075274104832",
        messageId: "123456789012345678",
        status: 502,
        reason: "agent_http_502",
        bodyLength: "raw body with sensitive details".length,
      }),
      "mjuclaw-agent forward failed"
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      "raw body with sensitive details"
    );
    expect(JSON.stringify(result)).not.toContain("raw body with sensitive details");
  });
});
