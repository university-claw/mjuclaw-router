import { ChannelType, type Client, type Message } from "discord.js";

import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { OpenClawForwarder } from "../forward/openclaw.js";
import { buildOnboardingPrompt } from "../onboarding/modal.js";
import type { OnboardingStatusChecker } from "../onboarding/status.js";
import { chunkForDiscord } from "./chunk.js";

export type HandlerDeps = {
  config: Config;
  logger: Logger;
  status: OnboardingStatusChecker;
  forwarder: OpenClawForwarder;
};

export function registerMessageHandlers(client: Client, deps: HandlerDeps) {
  const { logger, config, status, forwarder } = deps;

  client.on("messageCreate", async (message) => {
    try {
      if (!shouldHandle(message, client, config)) return;

      const userId = message.author.id;
      const reply = message.reply.bind(message);

      const onboard = await status.check(userId);
      logger.debug(
        { userId, authenticated: onboard.authenticated },
        "onboarding 상태 확인"
      );

      if (!onboard.authenticated) {
        logger.info({ userId }, "미온보딩 사용자 — modal prompt 발사");
        await reply(buildOnboardingPrompt());
        return;
      }

      // 온보딩 완료된 사용자 → openclaw로 forward
      const channel = message.channel;
      const sendTyping =
        "sendTyping" in channel ? channel.sendTyping.bind(channel) : null;
      if (sendTyping) await sendTyping();

      const result = await forwarder.forward({
        discordUserId: userId,
        message: message.content,
      });

      if (!result.ok) {
        logger.warn({ userId, reason: result.reason }, "forward 실패");
        await reply(
          "잠시 응답을 가져오는 중에 문제가 생겼어요. 다시 시도해 주세요."
        );
        return;
      }

      if (result.payloads.length === 0) {
        logger.debug({ userId }, "forward 성공이지만 payload 없음 (no-op)");
        return;
      }

      for (const p of result.payloads) {
        if (p.text && p.text.length > 0) {
          for (const chunk of chunkForDiscord(p.text)) {
            await reply(chunk);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "messageCreate 처리 중 예외");
    }
  });
}

function shouldHandle(message: Message, client: Client, config: Config): boolean {
  if (message.author.bot) return false;
  if (!message.content || message.content.trim().length === 0) return false;

  const channelType = message.channel.type;
  const isDm = channelType === ChannelType.DM;
  const isGuildText =
    channelType === ChannelType.GuildText ||
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread;

  if (config.DISCORD_GUILD_ID && message.guildId) {
    if (message.guildId !== config.DISCORD_GUILD_ID) return false;
  }

  if (isDm) return true;
  if (isGuildText && client.user && message.mentions.has(client.user.id)) {
    return true;
  }
  return false;
}
