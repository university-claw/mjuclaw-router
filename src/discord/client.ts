import { Client, GatewayIntentBits, Partials } from "discord.js";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

export function createDiscordClient(_config: Config, logger: Logger): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", (c) => {
    logger.info(
      { user: c.user.tag, id: c.user.id, guilds: c.guilds.cache.size },
      "Discord 클라이언트 ready"
    );
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord 클라이언트 에러");
  });

  client.on("shardError", (err) => {
    logger.error({ err }, "Discord shard 에러");
  });

  return client;
}
