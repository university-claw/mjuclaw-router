# Changelog

이 프로젝트의 변경사항은 이 파일에 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전 규칙은 [SemVer](https://semver.org/lang/ko/)를 따른다.

## [Unreleased]

### Added — MVP-2: Intent classifier 게이트 (abuse 차단)

- `src/classifier/client.ts` — mjuclaw-intent-serving HTTP 클라이언트.
  - `POST /classify` 호출, Bearer 인증, `AbortController` 기반 timeout.
  - top-3 결과 + `overriddenToAbuse` 플래그 + `pAbuse` 노출.
- `src/discord/handlers.ts` — onboarding 통과 후 forward 직전에 classifier 호출.
  - `final == "abuse"` → 정형 거절 응답으로 LLM 호출 0회.
  - 분류 실패(timeout/HTTP 오류) → fail-open으로 forward 진행 (사용자 경험 우선).
- 환경 변수: `CLASSIFIER_ENABLED`(기본 false), `CLASSIFIER_URL`,
  `CLASSIFIER_AUTH_TOKEN`, `CLASSIFIER_TIMEOUT_MS`(기본 2500ms).

### Added — HTTP send endpoint + Dockerfile 마무리

- `POST /discord/send` HTTP 엔드포인트 (`Authorization: Bearer ...`).
  - body `{ discordUserId, content }` → router가 자기 봇으로 DM 전송 후 200/502 응답.
  - mjuclaw-setup의 `bin/mju-news-alert`/`bin/mju-attendance-alert`가 OpenClaw discord 채널 비활성화 이후 router로 위임하기 위한 우회 경로.
- `GET /healthz` (인증 없이) — Discord ready 여부 노출.
- `HTTP_PORT`/`HTTP_BIND_HOST`/`HTTP_AUTH_TOKEN` 환경 변수.
- Dockerfile multi-stage 완성: stage 1 mju-cli 빌드(additional context), stage 2 router 빌드, stage 3 runtime + openclaw CLI + slim `mju` 래퍼.

### Added — MVP-1 scaffolding

- 신규 레포 `mjuclaw-router` 초기화 (Node 22, TypeScript ESM, NodeNext).
- `discord.js`로 Discord Gateway WebSocket 직접 listen.
- 온보딩 게이트: `mju auth status` 결과 기반으로 미온보딩 사용자에 대해 즉시 embed + 버튼 + modal 발사 (LLM 0회).
- 온보딩 modal 제출 → `mju auth login` subprocess 호출 → ephemeral 결과 통보.
- LLM forward: `openclaw agent --json` subprocess 호출 → payload 파싱 → Discord에 직접 post (`--deliver` 미사용).
- Discord 2000자 메시지 분할 헬퍼.
- `pino` 구조화 로거 + `zod` 환경 변수 파싱.
- Dockerfile (Node 22 + tini + 비루트 사용자 + OpenClaw CLI 글로벌 설치).
- README + .env.example.
