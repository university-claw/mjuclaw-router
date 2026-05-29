export type AcademicPlanningIntent =
  | "timetable-planner"
  | "graduation-roadmap";

const TIMETABLE_NOUNS = [
  "시간표",
  "수업 시간표",
  "강의 시간표",
  "timetable",
];

const TIMETABLE_PLANNING_TERMS = [
  "설계",
  "짜",
  "짜고",
  "짜줘",
  "만들",
  "랜덤",
  "무작위",
  "추천",
  "조합",
  "다음 학기",
  "다음학기",
  "전공",
  "교양",
  "요일 제외",
  "교시 제외",
  "안 겹치",
  "겹치지",
  "수강 계획",
  "계획",
];

const CURRENT_TIMETABLE_TERMS = [
  "현재 시간표",
  "이번 학기 시간표",
  "이번학기 시간표",
  "지금 시간표",
  "지금 듣는",
  "수강 중인",
  "수강중인",
  "msi 시간표",
  "내 시간표 보여",
];

const GRADUATION_ROADMAP_TERMS = [
  "졸업 로드맵",
  "졸업로드맵",
  "졸업요건",
  "졸업 요건",
  "졸업학점",
  "졸업 학점",
  "졸업까지",
  "뭐 남았",
  "뭘 들어야",
  "뭘 들었",
  "들은 과목",
  "남은 과목",
  "영역별 졸업",
];

const EXPIRED_VIEW_TERMS = [
  "만료",
  "만료됐",
  "만료되",
  "안 열",
  "안열",
  "다시 열",
  "다시 보내",
  "새 링크",
  "링크 다시",
  "웹뷰 다시",
];

const VIEW_LINK_TERMS = ["링크", "웹뷰", "view"];

const NON_WEBVIEW_EXPIRE_TERMS = [
  "세션",
  "로그인",
  "인증",
  "sso",
  "비밀번호",
  "패스워드",
  "토큰",
  "과제",
  "마감",
  "기간",
];

export function classifyAcademicPlanningIntent(
  message: string
): AcademicPlanningIntent | null {
  const text = normalize(message);

  if (includesAny(text, GRADUATION_ROADMAP_TERMS)) {
    return "graduation-roadmap";
  }

  const hasTimetableNoun = includesAny(text, TIMETABLE_NOUNS);
  if (!hasTimetableNoun) return null;

  const hasPlanningContext = includesAny(text, TIMETABLE_PLANNING_TERMS);
  if (!hasPlanningContext) return null;

  // "현재/이번 학기 시간표 보여줘"류는 기존 MSI 현재 시간표 기능으로 둔다.
  // 다만 "다음 학기 시간표 짜줘"처럼 설계 맥락이 명확하면 planner가 맞다.
  const isOnlyCurrentLookup =
    includesAny(text, CURRENT_TIMETABLE_TERMS) &&
    !includesAny(text, ["설계", "짜", "랜덤", "무작위", "추천", "다음 학기", "다음학기"]);
  if (isOnlyCurrentLookup) return null;

  return "timetable-planner";
}

export function isExpiredWebviewRefreshRequest(message: string): boolean {
  const text = normalize(message);
  const hasExpireContext = includesAny(text, EXPIRED_VIEW_TERMS);
  if (!hasExpireContext) return false;
  if (includesAny(text, VIEW_LINK_TERMS)) return true;

  // Discord replies often arrive as a short follow-up like "만료되었다는데?"
  // after the user clicked a webview. Avoid treating unrelated auth/deadline
  // expiry questions as webview refreshes.
  return text.length <= 30 && !includesAny(text, NON_WEBVIEW_EXPIRE_TERMS);
}

export function shouldAllowClassifierOverride(message: string): boolean {
  return (
    classifyAcademicPlanningIntent(message) !== null ||
    isExpiredWebviewRefreshRequest(message)
  );
}

export function buildOpenClawRoutingHint(message: string): string {
  const intent = classifyAcademicPlanningIntent(message);
  const refresh = isExpiredWebviewRefreshRequest(message);
  const lines: string[] = [];

  if (intent === "timetable-planner") {
    lines.push(
      "- 이번 요청은 현재 수강 시간표/출석이 아니라 '시간표 설계'입니다. `mju-timetable-planner {DISCORD_USER_ID} --format json`만 사용하세요."
    );
    lines.push(
      "- `mju ucheck`, `mju msi timetable`, 출석 웹뷰, 현재 시간표 웹뷰로 대체하지 마세요."
    );
  } else if (intent === "graduation-roadmap") {
    lines.push(
      "- 이번 요청은 기존 MSI 졸업요건 원본이 아니라 '졸업 로드맵'입니다. `mju-graduation-roadmap {DISCORD_USER_ID} --format json`만 사용하세요."
    );
    lines.push(
      "- 기능 부재로 거절하거나 `mju msi graduation`, 출석, 현재 시간표로 대체하지 마세요."
    );
  }

  if (refresh) {
    lines.push(
      "- 이번 요청은 웹뷰 링크 재발급 요청일 수 있습니다. 이전 `viewUrl`을 재사용하지 말고 원래 조회 명령을 다시 실행해 새 링크를 발급하세요."
    );
    lines.push(
      "- 웹뷰 링크 만료를 SSO 로그인 만료로 설명하거나 DM 재로그인을 요구하지 마세요."
    );
  }

  if (lines.length === 0) return "";
  return `[현재 요청 라우팅 힌트]\n${lines.join("\n")}\n[/현재 요청 라우팅 힌트]\n\n`;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => text.includes(normalize(candidate)));
}
