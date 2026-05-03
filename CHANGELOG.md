# Changelog

이 프로젝트의 변경사항은 이 파일에 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전 규칙은 [SemVer](https://semver.org/lang/ko/)를 따른다.

## [Unreleased]

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
