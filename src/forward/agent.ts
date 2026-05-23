import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type AgentForwardRequest = {
  discordUserId: string;
  messageId: string;
  messageText: string;
  channelType: "dm";
};

export type ForwardPayload = {
  text?: string;
  components?: unknown;
  raw: unknown;
};

export type ForwardResult =
  | { ok: true; payloads: ForwardPayload[]; raw: unknown }
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

      const payloads = this.extractPayloads(parsed);
      return { ok: true, payloads, raw: parsed };
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

  private extractPayloads(parsed: unknown): ForwardPayload[] {
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as Record<string, unknown>;
    const result = obj.result as Record<string, unknown> | undefined;
    const rawPayloads = Array.isArray(obj.payloads)
      ? obj.payloads
      : result && Array.isArray(result.payloads)
        ? result.payloads
        : [];

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
