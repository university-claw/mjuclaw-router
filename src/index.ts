import { IntentClassifierClient } from "./classifier/client.js";
import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/client.js";
import { registerMessageHandlers } from "./discord/handlers.js";
import { registerInteractionHandlers } from "./discord/interaction.js";
import { MjuClawAgentForwarder } from "./forward/agent.js";
import { createHttpServer } from "./http/server.js";
import { createLogger } from "./logger.js";
import { OnboardingLoginRunner } from "./onboarding/login.js";
import { OnboardingStatusChecker } from "./onboarding/status.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    {
      agentUrl: config.MJU_AGENT_URL,
      userDataRoot: config.USER_DATA_ROOT,
      httpPort: config.HTTP_PORT,
      classifierEnabled: config.CLASSIFIER_ENABLED,
      classifierUrl: config.CLASSIFIER_URL || "(disabled)",
    },
    "mjuclaw-router 시작"
  );

  const status = new OnboardingStatusChecker(config, logger);
  const loginRunner = new OnboardingLoginRunner(config, logger);
  const forwarder = new MjuClawAgentForwarder(config, logger);
  const classifier = new IntentClassifierClient(config, logger);

  const client = createDiscordClient(config, logger);
  registerMessageHandlers(client, {
    config,
    logger,
    status,
    forwarder,
    classifier,
  });
  registerInteractionHandlers(client, { logger, loginRunner });

  const httpServer = createHttpServer({
    port: config.HTTP_PORT,
    bindHost: config.HTTP_BIND_HOST,
    authToken: config.HTTP_AUTH_TOKEN,
    client,
    logger,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown 신호 수신, Discord/HTTP 종료");
    try {
      await new Promise<void>((resolve) =>
        httpServer.close(() => resolve())
      );
    } catch (err) {
      logger.error({ err }, "HTTP 서버 종료 중 오류");
    }
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
