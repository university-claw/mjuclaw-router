import { describe, expect, it } from "vitest";

import {
  buildOpenClawRoutingHint,
  classifyAcademicPlanningIntent,
  isExpiredWebviewRefreshRequest,
  shouldAllowClassifierOverride,
} from "../src/forward/academic-planning-routing.js";

describe("academic planning routing hints", () => {
  it.each([
    "시간표 설계 웹뷰 보여줘",
    "다음학기 시간표 짜고싶어",
    "전공 3개 교양 2개로 랜덤 시간표 만들어줘",
    "시간 안 겹치게 추천 시간표",
  ])("detects timetable planner intent: %s", (message) => {
    expect(classifyAcademicPlanningIntent(message)).toBe("timetable-planner");
    expect(shouldAllowClassifierOverride(message)).toBe(true);
    expect(buildOpenClawRoutingHint(message)).toContain("mju-timetable-planner");
    expect(buildOpenClawRoutingHint(message)).toContain("mju ucheck");
  });

  it.each([
    "내 현재 시간표 보여줘",
    "이번 학기 시간표",
    "msi 시간표 보여줘",
    "지금 듣는 수업 시간표 알려줘",
  ])("keeps current timetable lookup on the existing path: %s", (message) => {
    expect(classifyAcademicPlanningIntent(message)).toBeNull();
    expect(shouldAllowClassifierOverride(message)).toBe(false);
    expect(buildOpenClawRoutingHint(message)).not.toContain("mju-timetable-planner");
  });

  it.each([
    "졸업로드맵 보여줘",
    "졸업요건 보여줘",
    "졸업학점 궁금해",
    "졸업까지 뭐 남았어",
    "내가 뭘 들었고 뭘 들어야 해",
  ])("detects graduation roadmap intent: %s", (message) => {
    expect(classifyAcademicPlanningIntent(message)).toBe("graduation-roadmap");
    expect(shouldAllowClassifierOverride(message)).toBe(true);
    expect(buildOpenClawRoutingHint(message)).toContain("mju-graduation-roadmap");
    expect(buildOpenClawRoutingHint(message)).toContain("mju msi graduation");
  });

  it.each([
    "링크가 만료되었다는데?",
    "만료되었다는데?",
    "웹뷰 다시 열어줘",
    "새 링크 다시 보내줘",
  ])("detects expired webview refresh requests: %s", (message) => {
    expect(isExpiredWebviewRefreshRequest(message)).toBe(true);
    expect(shouldAllowClassifierOverride(message)).toBe(true);
    expect(buildOpenClawRoutingHint(message)).toContain("viewUrl");
    expect(buildOpenClawRoutingHint(message)).toContain("SSO 로그인 만료");
  });

  it.each(["다시", "안녕", "오늘 학식 알려줘", "로그인 세션이 만료됐어", "과제 마감 기간 만료야"])(
    "does not add broad hints for unrelated messages: %s",
    (message) => {
      expect(classifyAcademicPlanningIntent(message)).toBeNull();
      expect(isExpiredWebviewRefreshRequest(message)).toBe(false);
      expect(shouldAllowClassifierOverride(message)).toBe(false);
      expect(buildOpenClawRoutingHint(message)).toBe("");
    }
  );
});
