import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/client.js";
import { registerMessageHandlers } from "./discord/handlers.js";
import { registerInteractionHandlers } from "./discord/interaction.js";
import { OpenClawForwarder } from "./forward/openclaw.js";
import { createLogger } from "./logger.js";
import { OnboardingLoginRunner } from "./onboarding/login.js";
import { OnboardingStatusChecker } from "./onboarding/status.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    {
      gatewayUrl: config.OPENCLAW_GATEWAY_URL,
      userDataRoot: config.USER_DATA_ROOT,
    },
    "mjuclaw-router 시작"
  );

  const status = new OnboardingStatusChecker(config, logger);
  const loginRunner = new OnboardingLoginRunner(config, logger);
  const forwarder = new OpenClawForwarder(config, logger);

  const client = createDiscordClient(config, logger);
  registerMessageHandlers(client, { config, logger, status, forwarder });
  registerInteractionHandlers(client, { logger, loginRunner });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown 신호 수신, Discord 클라이언트 종료");
    try {
      await client.destroy();
    } catch (err) {
      logger.error({ err }, "Discord 클라이언트 종료 중 오류");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(config.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
