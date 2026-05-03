import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const ONBOARDING_BUTTON_ID = "mjuclaw:onboarding:open";
export const ONBOARDING_MODAL_ID = "mjuclaw:onboarding:submit";
export const FIELD_STUDENT_ID = "studentId";
export const FIELD_PASSWORD = "password";

export function buildOnboardingPrompt() {
  const embed = new EmbedBuilder()
    .setColor(0x4263eb)
    .setTitle("명지대 로그인이 필요해요")
    .setDescription(
      [
        "안녕하세요! mjuclaw를 사용하려면 먼저 명지대 통합 로그인이 필요합니다.",
        "아래 **로그인** 버튼을 누르면 학번/비밀번호 입력창이 열려요.",
        "",
        "입력한 자격 증명은 암호화되어 본인 전용 vault에만 저장됩니다.",
      ].join("\n")
    )
    .setFooter({ text: "이 단계는 LLM을 거치지 않는 결정론적 처리입니다." });

  const button = new ButtonBuilder()
    .setCustomId(ONBOARDING_BUTTON_ID)
    .setStyle(ButtonStyle.Primary)
    .setLabel("로그인")
    .setEmoji("🔐");

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  return { embeds: [embed], components: [row] };
}

export function buildOnboardingModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(ONBOARDING_MODAL_ID)
    .setTitle("명지대 통합 로그인");

  const studentInput = new TextInputBuilder()
    .setCustomId(FIELD_STUDENT_ID)
    .setLabel("학번")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: 60212158")
    .setMinLength(4)
    .setMaxLength(32)
    .setRequired(true);

  const passwordInput = new TextInputBuilder()
    .setCustomId(FIELD_PASSWORD)
    .setLabel("비밀번호")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("명지대 통합 로그인 비밀번호")
    .setMinLength(1)
    .setMaxLength(128)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(studentInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput)
  );

  return modal;
}
