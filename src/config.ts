import { z } from "zod";

const ConfigSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  USER_DATA_ROOT: z.string().min(1).default("/data/users"),
  OPENCLAW_GATEWAY_URL: z.string().min(1).default("ws://mjuclaw-agent:18789"),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_BIN: z.string().min(1).default("openclaw"),
  MJU_BIN: z.string().min(1).default("mju"),
  // HTTP 서버: 컨테이너 내부 alert helper(`mju-news-alert`, `mju-attendance-alert`)가
  // OpenClaw 측 Discord channel 비활성화에 따라 router로 우회하기 위해 사용한다.
  // docker-compose 내부 네트워크에서만 접근하므로 외부 노출 금지.
  HTTP_PORT: z.coerce.number().int().positive().default(3100),
  HTTP_BIND_HOST: z.string().min(1).default("0.0.0.0"),
  HTTP_AUTH_TOKEN: z
    .string()
    .min(16, "HTTP_AUTH_TOKEN must be at least 16 chars (recommend openssl rand -hex 32)"),
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
