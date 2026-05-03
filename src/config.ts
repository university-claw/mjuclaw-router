import { z } from "zod";

const ConfigSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  USER_DATA_ROOT: z.string().min(1).default("/data/users"),
  OPENCLAW_GATEWAY_URL: z.string().min(1).default("ws://mjuclaw-agent:18789"),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  OPENCLAW_BIN: z.string().min(1).default("openclaw"),
  MJU_BIN: z.string().min(1).default("mju"),
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
