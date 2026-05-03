import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export type TopItem = { label: string; score: number };

export type ClassifyResult = {
  final: string;
  overriddenToAbuse: boolean;
  pAbuse: number;
  top: TopItem[];
  latencyMs: number;
};

export type ClassifyOutcome =
  | { ok: true; result: ClassifyResult }
  | { ok: false; reason: string };

export class IntentClassifierClient {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  get enabled(): boolean {
    return this.config.CLASSIFIER_ENABLED && !!this.config.CLASSIFIER_URL;
  }

  async classify(text: string): Promise<ClassifyOutcome> {
    if (!this.enabled) {
      return { ok: false, reason: "disabled" };
    }
    const url = `${this.config.CLASSIFIER_URL.replace(/\/$/, "")}/classify`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.CLASSIFIER_AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${this.config.CLASSIFIER_AUTH_TOKEN}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.CLASSIFIER_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ text, top_k: 3 }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        this.logger.warn(
          { status: response.status, bodySnippet: body.slice(0, 200) },
          "classifier 비정상 응답"
        );
        return { ok: false, reason: `http_${response.status}` };
      }

      const json = (await response.json()) as Record<string, unknown>;
      const result = this.normalize(json);
      if (!result) {
        return { ok: false, reason: "invalid_response_shape" };
      }
      return { ok: true, result };
    } catch (err) {
      clearTimeout(timeoutId);
      const reason =
        err instanceof Error
          ? err.name === "AbortError"
            ? "timeout"
            : err.message
          : String(err);
      this.logger.warn({ err: reason }, "classifier 호출 실패");
      return { ok: false, reason };
    }
  }

  private normalize(json: Record<string, unknown>): ClassifyResult | null {
    const final = json.final;
    if (typeof final !== "string") return null;
    const top = Array.isArray(json.top)
      ? json.top
          .filter(
            (it): it is { label: string; score: number } =>
              !!it &&
              typeof (it as Record<string, unknown>).label === "string" &&
              typeof (it as Record<string, unknown>).score === "number"
          )
          .map((it) => ({ label: it.label, score: it.score }))
      : [];
    const pAbuse = typeof json.p_abuse === "number" ? json.p_abuse : 0;
    const overriddenToAbuse =
      typeof json.overridden_to_abuse === "boolean"
        ? json.overridden_to_abuse
        : false;
    const latencyMs =
      typeof json.latency_ms === "number" ? json.latency_ms : 0;
    return { final, overriddenToAbuse, pAbuse, top, latencyMs };
  }
}

export const ABUSE_REFUSAL_TEXT =
  "이 메시지에는 응답할 수 없어요.\n" +
  "mjuclaw는 명지대 학사 정보 도우미예요. 학교 생활에 대한 질문을 보내 주세요. " +
  "(예: \"오늘 수업 뭐 있어?\", \"이번 주 학식 메뉴\", \"미제출 과제 있어?\")";
