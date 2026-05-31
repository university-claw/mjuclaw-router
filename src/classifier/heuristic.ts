// Classifier 모델이 잡지 못하는 한국어 자연체 정보 추출/탈옥 패턴을 보조로 차단.
// 이 룰은 모델 보강 전 안전망이므로 명백한 abuse 의도만 좁게 잡는다.
//
// 매칭 시 router는 abuse로 처리한다. classifier 결과와 OR 결합:
//   if classifier.final == "abuse" OR matchAbuseHeuristic(text)  → block
//
// false positive를 줄이기 위해 대부분 단순 단어 매칭이 아니라 위험 명사와
// 명령형/탈취형 동사가 함께 나타나는 경우만 잡는다.

const PROMPT_OVERRIDE_PHRASES = [
  "ignore previous",
  "ignore all previous",
  "disregard previous",
  "forget previous instructions",
  "forget all instructions",
  "override previous instructions",
  "DAN mode",
  "developer mode",
  "jailbreak mode",
  "이전 지시 무시",
  "이전 지침 무시",
  "선행 지시 무시",
  "위 지시 무시",
  "기존 지시 무시",
  "기존 규칙 무시",
  "시스템 지시 무시",
  "개발자 지시 무시",
  "제한 해제",
  "안전장치 해제",
  "검열 없이 답",
  "탈옥 모드",
  "개발자 모드로 전환",
];

// 짧은 probe 메시지는 "대상 + 동사" 구조가 없어도 내부 상태 탐색 의도가 강하다.
// 단독 토큰으로 들어온 경우에만 차단해 일반 문장 false positive를 줄인다.
const BARE_INTERNAL_PROBE_MESSAGES = [
  "user",
  "users",
  "사용자",
  "유저",
  "사용자 목록",
  "유저 목록",
  "user list",
  "users list",
  "user_data",
  "user_data.profiles",
  "/data/users",
  "logic",
  "로직",
  "처리 로직",
  "응답 로직",
  "라우팅 로직",
  "분류 로직",
  "차단 로직",
  "검열 로직",
  "router",
  "라우터",
  "classifier",
  "분류기",
];

const BENIGN_PROMPT_CONTEXTS = [
  "do not ignore",
  "don't ignore",
  "what is",
  "how to defend",
  "defense",
  "prevention",
  "explain",
  "concept",
  "chrome developer mode",
  "browser developer mode",
  "방어",
  "방지",
  "개념",
  "무엇",
  "뭐야",
  "설명",
  "예시",
  "탐지",
  "대응",
  "크롬 developer mode",
  "브라우저 developer mode",
  "개발자 도구",
];

const PROMPT_ATTACK_NOUNS = [
  "프롬프트 인젝션",
  "prompt injection",
  "jailbreak",
  "탈옥",
];

const PROMPT_ATTACK_VERBS = [
  "해줘",
  "시도",
  "공격",
  "수행",
  "실행",
  "걸어",
  "만들",
  "작성",
  "우회",
  "attack",
  "perform",
  "execute",
  "bypass",
];

const PROMPT_OVERRIDE_NOUNS = [
  "이전 지시",
  "이전 지침",
  "선행 지시",
  "위 지시",
  "기존 지시",
  "기존 규칙",
  "시스템 지시",
  "개발자 지시",
  "system instruction",
  "system instructions",
  "developer instruction",
  "developer instructions",
  "safety policy",
  "정책",
  "규칙",
  "룰",
];

const OVERRIDE_VERBS = [
  "무시",
  "잊어",
  "지워",
  "삭제",
  "따르지",
  "덮어써",
  "우회",
  "해제",
  "ignore",
  "disregard",
  "forget",
  "override",
  "bypass",
];

// 모델 정체성 / 내부 동작 / 소스 정보 추출 시도.
const INTERNAL_PROBE_NOUNS = [
  "내부 코드",
  "내부 구조",
  "내부 동작",
  "내부 로직",
  "처리 로직",
  "응답 로직",
  "라우팅 로직",
  "분류 로직",
  "차단 로직",
  "검열 로직",
  "내부 설정",
  "내부 파일",
  "내부 데이터",
  "소스 코드",
  "소스코드",
  "source code",
  "router",
  "라우터",
  "classifier",
  "분류기",
  "처리 방식",
  "시스템 프롬프트",
  "system prompt",
  "internal prompt",
  "내부 프롬프트",
  "숨겨진 프롬프트",
  "developer prompt",
  "developer message",
  "내부 지시",
  "숨겨진 지침",
  "openclaw 설정",
  "openclaw config",
  "router 설정",
  "runtime context",
  "system message",
  "tool schema",
  "function schema",
  "tool registry",
  "function registry",
  "tool 목록",
  "tools 목록",
  "도구 목록",
  "사용 가능한 도구",
  "사용 가능한 tool",
  "숨겨진 도구",
  "숨겨진 tool",
  "admin tool",
  "관리자 도구",
  "명령어 목록",
  "실행 가능한 명령",
  "skill 코드",
];

const REVEAL_VERBS = [
  "알려",
  "보여",
  "공개",
  "출력",
  "노출",
  "말해",
  "show",
  "reveal",
  "tell me",
  "list",
  "dump",
  "print",
  "display",
  "expose",
  "leak",
  "export",
  "읽어",
  "가져와",
  "뽑아",
  "열람",
  "추출",
  "검증",
  "검사",
  "확인",
  "테스트",
  "분석",
  "inspect",
  "verify",
  "validate",
  "test",
];

const SECRET_NOUNS = [
  ".env",
  "환경변수",
  "환경 변수",
  "env var",
  "env vars",
  "environment variable",
  "environment variables",
  "api key",
  "apikey",
  "api_key",
  "token",
  "토큰",
  "secret",
  "비밀키",
  "password",
  "passwd",
  "비밀번호",
  "cookie",
  "쿠키",
  "session cookie",
  "credential",
  "credentials",
  "access token",
  "refresh token",
  "discord_bot_token",
  "openclaw_gateway_token",
  "classifier_auth_token",
];

const SECRET_ACCESS_VERBS = [
  ...REVEAL_VERBS,
  "cat",
  "type",
  "more",
  "less",
  "printenv",
];

const BENIGN_SECRET_HELP_CONTEXTS = [
  "비밀번호 변경",
  "비밀번호 재설정",
  "비밀번호 찾",
  "로그인이 안",
  "로그인 안",
  "토큰 회전",
  "token rotation",
  "rotate an api key",
  "rotate api key",
  "rotate token",
  "password reset",
  "reset page",
  "recover password",
  "change password",
  "토큰 관리",
  "api key 관리",
  "api key rotation",
  "키 관리",
  "비밀키 관리",
  "manage api key",
  "store api key",
  "api key safely",
  "token safely",
  "credential safely",
  "환경변수란",
  "환경 변수란",
  "환경변수 관리",
  "환경 변수 관리",
  "what is env var",
  "what are env vars",
  "environment variable management",
  "마스킹",
  "redaction",
  "redact",
];

const SECRET_FORCE_BLOCK_CONTEXTS = [
  ".env",
  "discord_bot_token",
  "openclaw_gateway_token",
  "classifier_auth_token",
  "session cookie",
  "access token",
  "refresh token",
  "cat",
  "printenv",
  "dump",
  "reveal",
  "expose",
  "leak",
  "export",
  "출력",
  "노출",
  "공개",
  "읽어",
  "가져와",
  "뽑아",
  "열람",
  "추출",
  "값",
  "value",
  "파일",
  "file",
];

const CROSS_USER_REFERENCES = [
  "다른 사용자",
  "다른 유저",
  "다른 학생",
  "다른 사람",
  "남의",
  "타인",
  "타 사용자",
  "타 유저",
  "타 학생",
  "모든 사용자",
  "모든 학생",
  "전체 사용자",
  "전체 유저",
  "전체 학생",
  "학생 전체",
  "이전 사용자",
  "저번 사용자",
  "교수님 계정",
  "교수 계정",
  "관리자 계정",
  "다른 계정",
  "타 계정",
  "all users",
  "all students",
  "every user",
  "every student",
  "other user",
  "other users",
  "another user",
  "another student",
  "previous user",
  "last user",
  "someone else's",
  "users",
  "users list",
  "user list",
  "user table",
  "users table",
  "user db",
  "users db",
  "user_data",
  "user_data.profiles",
  "다른 discord",
  "사용자 목록",
  "유저 목록",
  "사용자 리스트",
  "유저 리스트",
  "사용자 db",
  "유저 db",
];

const SENSITIVE_DATA_NOUNS = [
  "사용자",
  "유저",
  "사용자 목록",
  "유저 목록",
  "사용자 리스트",
  "유저 리스트",
  "user",
  "users",
  "user data",
  "users data",
  "성적",
  "출석",
  "과제",
  "lms",
  "메일",
  "이메일",
  "전화번호",
  "연락처",
  "주소",
  "학번",
  "개인정보",
  "개인 정보",
  "상담 기록",
  "상담 내역",
  "장학금 내역",
  "장학 내역",
  "등록금 납부 내역",
  "등록금 내역",
  "계정",
  "세션",
  "쿠키",
  "토큰",
  "비밀번호",
  "수강내역",
  "수강 내역",
  "명단",
  "grade",
  "grades",
  "attendance",
  "assignment",
  "assignments",
  "email",
  "email address",
  "phone",
  "phone number",
  "address",
  "student id",
  "profile",
  "profiles",
  "user profile",
  "user profiles",
  "account",
  "session",
  "sessions",
  "personal data",
  "pii",
  "목록",
  "리스트",
  "db",
];

const DATA_ACCESS_VERBS = [
  "조회",
  "보여",
  "가져와",
  "출력",
  "다운로드",
  "export",
  "뽑아",
  "열람",
  "알려",
  "검색",
  "찾아",
  "읽어",
  "확인",
  "검증",
  "검사",
  "테스트",
  "분석",
  "list",
  "dump",
  "show",
  "download",
  "search",
  "find",
  "read",
  "inspect",
  "verify",
  "validate",
  "test",
];

const AUTH_BYPASS_HARD_PHRASES = [
  "권한 체크 무시",
  "권한 검사 무시",
  "권한 확인 무시",
  "인증 우회",
  "auth bypass",
  "authorization bypass",
  "다른 사용자로 실행",
  "다른 계정으로 처리",
  "app-dir 변경",
  "app-dir 바꿔",
  "app-dir로 실행",
  "다른 app-dir",
  "appdir 변경",
  "appdir 바꿔",
  "appdir로 실행",
  "다른 appdir",
  "세션 변경",
  "세션 바꿔",
  "session 변경",
  "session 바꿔",
  "이전 세션 사용",
  "저번 세션 사용",
  "다른 세션으로",
];

const AUTH_BYPASS_CONTEXT_TERMS = [
  "로그인 없이",
  "without login",
  "관리자 권한",
  "관리자 모드",
  "admin privileges",
  "admin mode",
  "root 권한",
  "루트 권한",
  "sudo",
  "--app-dir",
  "/data/users/",
  "/data/users",
  "user_data",
  "user_data.profiles",
  "app-dir",
  "appdir",
  "세션",
  "session",
];

const AUTH_BYPASS_ACTION_TERMS = [
  "성적",
  "출석",
  "과제",
  "lms",
  "개인정보",
  "계정",
  "사용자",
  "다른",
  "남의",
  "타인",
  "권한",
  "우회",
  "무시",
  "바꿔",
  "변경",
  "처리",
  "조회",
  "가져와",
  "보여",
  "실행",
  "접근",
  "파일",
  "목록",
  "리스트",
  "확인",
  "검증",
  "검사",
  "테스트",
  "분석",
  "access",
  "bypass",
  "another user",
  "other user",
  "all users",
  "switch",
  "impersonate",
  "inspect",
  "verify",
  "validate",
  "test",
];

const AUTHORITY_CLAIMS = [
  "나 개발자인데",
  "제가 개발자인데",
  "나는 개발자인데",
  "나 관리자인데",
  "제가 관리자인데",
  "나는 관리자인데",
  "나 운영자인데",
  "제가 운영자인데",
  "나 팀원인데",
  "제가 팀원인데",
  "교수인데",
  "직원인데",
];

const AUTHORITY_ESCALATION_TERMS = [
  "권한",
  "관리자",
  "인증",
  "우회",
  "접근",
  "열어",
  "보여",
  "처리",
  "실행",
  "app-dir",
  "세션",
];

export type HeuristicResult = {
  blocked: boolean;
  reason?: string;
  matched?: string;
};

export function matchAbuseHeuristic(text: string): HeuristicResult {
  const lower = normalizeText(text);

  // 0) "users", "로직"처럼 짧은 내부 탐색 토큰만 단독으로 보낸 경우.
  const bareProbe = findExact(lower, BARE_INTERNAL_PROBE_MESSAGES);
  if (bareProbe) {
    return {
      blocked: true,
      reason: "bare_internal_probe",
      matched: bareProbe,
    };
  }

  // 1) 명확한 prompt override / jailbreak 지시.
  const overridePhrase = findIncluded(lower, PROMPT_OVERRIDE_PHRASES);
  if (overridePhrase && !hasBenignPromptContext(lower)) {
    return {
      blocked: true,
      reason: "jailbreak_keyword",
      matched: overridePhrase,
    };
  }
  const promptAttack = findPair(lower, PROMPT_ATTACK_NOUNS, PROMPT_ATTACK_VERBS);
  if (promptAttack && !hasBenignPromptContext(lower)) {
    return {
      blocked: true,
      reason: "jailbreak_keyword",
      matched: `${promptAttack.noun} + ${promptAttack.verb}`,
    };
  }
  const overridePair = findPair(lower, PROMPT_OVERRIDE_NOUNS, OVERRIDE_VERBS);
  if (overridePair) {
    return {
      blocked: true,
      reason: "prompt_override",
      matched: `${overridePair.noun} + ${overridePair.verb}`,
    };
  }

  // 2) "내부 코드 + 알려/보여" 같이 명령형 동사와 함께일 때만 차단.
  //    예: "내부 코드 알려줘"는 차단, "내부 코드 궁금하다" 정도는 통과.
  const internalProbe = findPair(lower, INTERNAL_PROBE_NOUNS, REVEAL_VERBS);
  if (internalProbe) {
    return {
      blocked: true,
      reason: "internal_probe",
      matched: `${internalProbe.noun} + ${internalProbe.verb}`,
    };
  }

  // 3) secret / credential 탈취. 단, 계정 복구나 보안 운영 질문은 통과시킨다.
  const secretProbe = findPair(lower, SECRET_NOUNS, SECRET_ACCESS_VERBS);
  if (
    secretProbe &&
    (hasSecretForceBlockContext(lower) || !hasBenignSecretHelpContext(lower))
  ) {
    return {
      blocked: true,
      reason: "secret_probe",
      matched: `${secretProbe.noun} + ${secretProbe.verb}`,
    };
  }

  // 4) 다른 사용자 또는 전체 사용자에 대한 민감 학사/개인정보 접근 시도.
  const crossUserProbe = findTriple(
    lower,
    CROSS_USER_REFERENCES,
    SENSITIVE_DATA_NOUNS,
    DATA_ACCESS_VERBS
  );
  if (crossUserProbe) {
    return {
      blocked: true,
      reason: "cross_user_data",
      matched: `${crossUserProbe.first} + ${crossUserProbe.second} + ${crossUserProbe.third}`,
    };
  }

  // 5) auth/session/app-dir 우회 또는 자기 권한 사칭.
  const authBypass = findIncluded(lower, AUTH_BYPASS_HARD_PHRASES);
  if (authBypass) {
    return { blocked: true, reason: "auth_bypass", matched: authBypass };
  }
  const authBypassContext = findPair(
    lower,
    AUTH_BYPASS_CONTEXT_TERMS,
    AUTH_BYPASS_ACTION_TERMS
  );
  if (authBypassContext) {
    return {
      blocked: true,
      reason: "auth_bypass",
      matched: `${authBypassContext.noun} + ${authBypassContext.verb}`,
    };
  }
  const authorityClaim = findPair(
    lower,
    AUTHORITY_CLAIMS,
    AUTHORITY_ESCALATION_TERMS
  );
  if (authorityClaim) {
    return {
      blocked: true,
      reason: "auth_bypass",
      matched: `${authorityClaim.noun} + ${authorityClaim.verb}`,
    };
  }

  return { blocked: false };
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function findIncluded(text: string, candidates: readonly string[]) {
  return candidates.find((candidate) =>
    text.includes(normalizeText(candidate))
  );
}

function findExact(text: string, candidates: readonly string[]) {
  return candidates.find((candidate) => text === normalizeText(candidate));
}

function findPair(
  text: string,
  nouns: readonly string[],
  verbs: readonly string[]
) {
  const noun = findIncluded(text, nouns);
  if (!noun) return null;

  const verb = findIncluded(text, verbs);
  if (!verb) return null;

  return { noun, verb };
}

function findTriple(
  text: string,
  firstCandidates: readonly string[],
  secondCandidates: readonly string[],
  thirdCandidates: readonly string[]
) {
  const first = findIncluded(text, firstCandidates);
  if (!first) return null;

  const second = findIncluded(text, secondCandidates);
  if (!second) return null;

  const third = findIncluded(text, thirdCandidates);
  if (!third) return null;

  return { first, second, third };
}

function hasBenignSecretHelpContext(text: string): boolean {
  return findIncluded(text, BENIGN_SECRET_HELP_CONTEXTS) !== undefined;
}

function hasBenignPromptContext(text: string): boolean {
  return findIncluded(text, BENIGN_PROMPT_CONTEXTS) !== undefined;
}

function hasSecretForceBlockContext(text: string): boolean {
  return findIncluded(text, SECRET_FORCE_BLOCK_CONTEXTS) !== undefined;
}
