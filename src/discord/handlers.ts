import { ChannelType, type Client, type Message } from "discord.js";

import {
  ABUSE_REFUSAL_TEXT,
  type IntentClassifierClient,
} from "../classifier/client.js";
import { matchAbuseHeuristic } from "../classifier/heuristic.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { MjuClawAgentForwarder } from "../forward/agent.js";
import { buildOnboardingPrompt } from "../onboarding/modal.js";
import type { OnboardingStatusChecker } from "../onboarding/status.js";
import { chunkForDiscord } from "./chunk.js";

export type HandlerDeps = {
  config: Config;
  logger: Logger;
  status: OnboardingStatusChecker;
  forwarder: MjuClawAgentForwarder;
  classifier: IntentClassifierClient;
};

export function registerMessageHandlers(client: Client, deps: HandlerDeps) {
  const { logger, config, status, forwarder, classifier } = deps;

  client.on("messageCreate", async (message) => {
    try {
      if (!shouldHandle(message, config)) return;

      const userId = message.author.id;
      const reply = message.reply.bind(message);

      logger.info(
        {
          userId,
          messageId: message.id,
          channelId: message.channelId,
          guildId: message.guildId,
          contentLength: message.content.length,
        },
        "discord 사용자 원문 메시지 수신"
      );

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

      // ── Intent classifier + heuristic 게이트 (MVP-2) ──────────
      // 분류 모델은 영어 prompt-injection 위주 학습이라 한국어 자연체 정보 추출
      // ("내부 코드 알려줘", "system prompt 보여줘")을 못 잡는 약점이 있다.
      // 모델 결과와 키워드 휴리스틱을 OR 로 결합한다 — 둘 중 하나라도 abuse면 차단.
      // 분류 실패는 fail-open이지만 휴리스틱은 항상 평가한다 (모델 다운 시 최소 안전망).

      const heuristic = matchAbuseHeuristic(message.content);

      if (classifier.enabled) {
        const outcome = await classifier.classify(message.content);
        if (outcome.ok) {
          logger.info(
            {
              userId,
              final: outcome.result.final,
              pAbuse: outcome.result.pAbuse,
              overridden: outcome.result.overriddenToAbuse,
              latencyMs: outcome.result.latencyMs,
              heuristic: heuristic.blocked
                ? { reason: heuristic.reason, matched: heuristic.matched }
                : null,
            },
            "intent classified"
          );
          if (outcome.result.final === "abuse" || heuristic.blocked) {
            logger.info(
              {
                userId,
                source:
                  outcome.result.final === "abuse"
                    ? "classifier"
                    : "heuristic",
                heuristicReason: heuristic.reason,
              },
              "abuse 차단 — 정형 거절 응답"
            );
            await reply(ABUSE_REFUSAL_TEXT);
            return;
          }
        } else {
          logger.warn(
            { userId, reason: outcome.reason, heuristicBlocked: heuristic.blocked },
            "classifier 호출 실패 — heuristic만 평가"
          );
          if (heuristic.blocked) {
            logger.info(
              { userId, heuristicReason: heuristic.reason },
              "abuse 차단 — heuristic only (classifier down)"
            );
            await reply(ABUSE_REFUSAL_TEXT);
            return;
          }
        }
      } else if (heuristic.blocked) {
        // classifier 비활성화 환경에서도 휴리스틱은 동작.
        logger.info(
          { userId, heuristicReason: heuristic.reason },
          "abuse 차단 — heuristic (classifier disabled)"
        );
        await reply(ABUSE_REFUSAL_TEXT);
        return;
      }

      // 온보딩 완료 + (필요 시) 분류 통과 사용자 → mjuclaw-agent로 forward
      const channel = message.channel;
      const sendTyping =
        "sendTyping" in channel ? channel.sendTyping.bind(channel) : null;
      if (sendTyping) await sendTyping();

      const result = await forwarder.forward({
        discordUserId: userId,
        messageId: message.id,
        messageText: message.content,
        channelType: "dm",
      });

      if (!result.ok) {
        logger.warn({ userId, reason: result.reason }, "forward 실패");
        await reply(
          "잠시 응답을 가져오는 중에 문제가 생겼어요. 다시 시도해 주세요."
        );
        return;
      }

      if (result.response.messages.length === 0) {
        logger.debug({ userId }, "forward 성공이지만 message 없음 (no-op)");
        return;
      }

      for (const message of result.response.messages) {
        if (message.type === "text") {
          for (const chunk of chunkForDiscord(message.text)) {
            await reply(chunk);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "messageCreate 처리 중 예외");
    }
  });
}

function shouldHandle(message: Message, config: Config): boolean {
  if (message.author.bot) return false;
  if (!message.content || message.content.trim().length === 0) return false;

  const channelType = message.channel.type;
  const isDm = channelType === ChannelType.DM;
  if (config.DISCORD_GUILD_ID && message.guildId) {
    if (message.guildId !== config.DISCORD_GUILD_ID) return false;
  }

  return isDm;
}
