import { z } from "zod";

const ConfigSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  USER_DATA_ROOT: z.string().min(1).default("/data/users"),
  DISCORD_ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  OPENCLAW_GATEWAY_URL: z.string().min(1).default("ws://mjuclaw-agent:18789"),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_BIN: z.string().min(1).default("openclaw"),
  MJU_BIN: z.string().min(1).default("mju"),
  MJU_TIMETABLE_PLANNER_BIN: z.string().min(1).default("mju-timetable-planner"),
  MJU_GRADUATION_ROADMAP_BIN: z.string().min(1).default("mju-graduation-roadmap"),
  ACADEMIC_PLANNING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600_000),
  // HTTP 서버: 컨테이너 내부 alert helper(`mju-news-alert`, `mju-attendance-alert`)가
  // OpenClaw 측 Discord channel 비활성화에 따라 router로 우회하기 위해 사용한다.
  // docker-compose 내부 네트워크에서만 접근하므로 외부 노출 금지.
  HTTP_PORT: z.coerce.number().int().positive().default(3100),
  HTTP_BIND_HOST: z.string().min(1).default("0.0.0.0"),
  HTTP_AUTH_TOKEN: z
    .string()
    .min(16, "HTTP_AUTH_TOKEN must be at least 16 chars (recommend openssl rand -hex 32)"),
  // 온보딩 후속 트리거 — agent 측 view-server의 /internal/onboarding-postlogin 호출.
  // mju auth login 성공 직후 출석 알림 cron + 공지 알림 설문 Poll 등록을 위임한다.
  // Bearer 토큰은 HTTP_AUTH_TOKEN을 재사용 (router/agent 양쪽 env에 같은 값으로 주입).
  VIEW_SERVER_URL: z.string().min(1).default("http://mjuclaw-agent:3001"),
  // ── Intent classifier (MVP-2) ────────────────────────────────
  // mjuclaw-intent-serving HTTP를 호출해 abuse 차단 + (향후) service 라우팅 분기.
  // 비활성화 시 router는 모든 onboarded 메시지를 그대로 forward (MVP-1 동작).
  CLASSIFIER_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === "boolean" ? v : /^(1|true|yes|on)$/i.test(v)))
    .default(false),
  CLASSIFIER_URL: z.string().default(""),
  CLASSIFIER_AUTH_TOKEN: z.string().default(""),
  CLASSIFIER_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production"]).default("production"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
