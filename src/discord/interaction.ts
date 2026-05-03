import { type Client, MessageFlags } from "discord.js";

import type { Logger } from "../logger.js";
import type { OnboardingLoginRunner } from "../onboarding/login.js";
import {
  FIELD_PASSWORD,
  FIELD_STUDENT_ID,
  ONBOARDING_BUTTON_ID,
  ONBOARDING_MODAL_ID,
  buildOnboardingModal,
} from "../onboarding/modal.js";

export type InteractionDeps = {
  logger: Logger;
  loginRunner: OnboardingLoginRunner;
};

export function registerInteractionHandlers(
  client: Client,
  deps: InteractionDeps
) {
  const { logger, loginRunner } = deps;

  client.on("interactionCreate", async (interaction) => {
    try {
      if (
        interaction.isButton() &&
        interaction.customId === ONBOARDING_BUTTON_ID
      ) {
        await interaction.showModal(buildOnboardingModal());
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId === ONBOARDING_MODAL_ID
      ) {
        const studentId = interaction.fields
          .getTextInputValue(FIELD_STUDENT_ID)
          .trim();
        const password = interaction.fields.getTextInputValue(FIELD_PASSWORD);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await loginRunner.login(
          interaction.user.id,
          studentId,
          password
        );

        if (result.ok) {
          logger.info(
            { userId: interaction.user.id, studentId },
            "온보딩 로그인 성공"
          );
          await interaction.editReply(
            "✅ 명지대 통합 로그인이 완료됐어요. 이제 자유롭게 mjuclaw에게 이야기해 주세요."
          );
        } else {
          logger.warn(
            { userId: interaction.user.id, reason: result.reason },
            "온보딩 로그인 실패"
          );
          await interaction.editReply(
            `❌ 로그인에 실패했어요.\n사유: ${result.reason}\n\n학번/비밀번호를 다시 확인하고 같은 메시지를 한 번 더 보내 주세요.`
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "interactionCreate 처리 중 예외");
      try {
        if (interaction.isRepliable() && !interaction.replied) {
          await interaction.reply({
            content:
              "처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // ignore
      }
    }
  });
}
