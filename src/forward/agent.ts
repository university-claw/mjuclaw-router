import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type AgentForwardRequest = {
  discordUserId: string;
  messageId: string;
  messageText: string;
  channelType: "dm";
};

export type AgentResponseStatus = "ok" | "blocked" | "unavailable";

export type AgentTextMessage = {
  type: "text";
  text: string;
};

export type AgentResponse = {
  status: AgentResponseStatus;
  messages: AgentTextMessage[];
};

export type ForwardResult =
  | { ok: true; response: AgentResponse; raw: unknown }
  | { ok: false; reason: string; raw?: unknown };

export class MjuClawAgentForwarder {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  async forward(params: AgentForwardRequest): Promise<ForwardResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.MJU_AGENT_TIMEOUT_MS
    );

    try {
      const response = await fetch(this.config.MJU_AGENT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discordUserId: params.discordUserId,
          messageId: params.messageId,
          messageText: params.messageText,
          channelType: params.channelType,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const reason = `agent_http_${response.status}`;
        this.logger.warn(
          {
            discordUserId: params.discordUserId,
            messageId: params.messageId,
            status: response.status,
            reason,
            bodyLength: body.length,
          },
          "mjuclaw-agent forward failed"
        );
        return { ok: false, reason };
      }

      const parsed = await response.json().catch(() => undefined);
      if (!parsed) {
        return {
          ok: false,
          reason: "agent_response_not_json",
        };
      }

      const agentResponse = this.parseAgentResponse(parsed);
      if (!agentResponse) {
        return {
          ok: false,
          reason: "agent_response_invalid",
        };
      }

      return { ok: true, response: agentResponse, raw: parsed };
    } catch (err) {
      clearTimeout(timeoutId);
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? "agent_timeout"
          : "agent_call_failed";
      this.logger.error(
        { discordUserId: params.discordUserId, messageId: params.messageId, reason },
        "mjuclaw-agent call failed"
      );
      return { ok: false, reason };
    }
  }

  private parseAgentResponse(parsed: unknown): AgentResponse | null {
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const status = obj.status;
    if (!isAgentResponseStatus(status)) return null;

    if (!Array.isArray(obj.messages) || obj.messages.length === 0) return null;

    const messages: AgentTextMessage[] = [];
    for (const item of obj.messages) {
      const message = parseAgentTextMessage(item);
      if (!message) return null;
      messages.push(message);
    }

    if ((status === "blocked" || status === "unavailable") && messages.length !== 1) {
      return null;
    }

    return { status, messages };
  }
}

function isAgentResponseStatus(value: unknown): value is AgentResponseStatus {
  return value === "ok" || value === "blocked" || value === "unavailable";
}

function parseAgentTextMessage(value: unknown): AgentTextMessage | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.type !== "text") return null;
  if (typeof obj.text !== "string" || obj.text.trim().length === 0) return null;
  return { type: "text", text: obj.text };
}
