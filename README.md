# mjuclaw-router

mjuclaw 시스템의 **Discord 입구**. OpenClaw 게이트웨이 앞단에 위치하는 별도 Node.js 서비스로, 온보딩 미완 사용자에 대한 LLM 호출을 100% 결정론적으로 차단하고, 자유 대화만 OpenClaw로 forward한다. 향후 Discord → intent-classifier → OpenClaw 파이프라인의 첫 hop 역할도 한다.

## 왜 이 레포가 필요했나

OpenClaw 2026.4.11 기준 plugin SDK의 dispatch 단계 hook들은 modal/components를 직접 발사하는 길이 막혀 있다 (`before_dispatch` return은 텍스트만, `ReplyPayload`에 components 자리 없음). 또 `child_process.spawn('openclaw message send --components ...')` 패턴은 interactive entry가 child의 in-memory storage에 저장되어 child 종료 시 휘발 → modal 버튼이 즉시 expired 되는 구조적 문제가 있다.

따라서 deterministic 온보딩 + 확장 가능한 abuse 차단 layer는 OpenClaw 안에 가두는 plugin이 아니라 **OpenClaw 앞단의 별도 router service**가 정답 layer다.

## 아키텍처

```
Discord DM / 길드 mention
        ↓ Discord Gateway WebSocket (router가 단독으로 listen)
mjuclaw-router (Node.js, discord.js)
        ├─ 온보딩 상태 확인 (mju-cli `mju auth status` 호출)
        │     ↓ 미온보딩 → 즉시 modal 발사 (LLM 0회)
        │     ↓ 온보딩 완료 → forward
        ├─ (MVP-2 예정) intent-classifier 분류
        │     ↓ abuse → 차단 + 통보, 일반 → forward
        └─ openclaw agent --json 호출
                ↓ JSON 응답 수신
              router가 Discord에 직접 post
```

OpenClaw 측 Discord 채널은 비활성화되어 있어야 한다 (단일 봇 토큰을 router가 단독 소유). cron 알림 등 OpenClaw의 기존 outbound 흐름은 별도 PR에서 router HTTP endpoint로 마이그레이션 예정.

## 디렉토리

```
src/
├── index.ts              엔트리. config 로드 → Discord 연결 → 핸들러 등록
├── config.ts             zod 기반 환경 변수 파싱
├── logger.ts             pino 구조화 로거
├── discord/
│   ├── client.ts         discord.js Client 팩토리
│   ├── handlers.ts       messageCreate → 온보딩 게이트 → forward
│   ├── attachments.ts    Discord 첨부파일 → 사용자별 app-dir 저장 + forward 컨텍스트
│   ├── interaction.ts    버튼 클릭 → modal 발사, modal 제출 → mju-login
│   └── chunk.ts          Discord 2000자 분할
├── onboarding/
│   ├── status.ts         mju-cli `auth status --format json` subprocess
│   ├── modal.ts          embed/button/modal builder + customId 상수
│   └── login.ts          mju-cli `auth login --format json` subprocess
└── forward/
    └── openclaw.ts       openclaw `agent --json` subprocess
```

## 환경 변수

`.env.example` 참고. 필수: `DISCORD_BOT_TOKEN`. 권장: `OPENCLAW_GATEWAY_URL`(기본 `ws://mjuclaw-agent:18789`), `OPENCLAW_GATEWAY_TOKEN`, `USER_DATA_ROOT`(기본 `/data/users`). Discord 첨부파일은 `USER_DATA_ROOT/<discord-id>/discord-attachments/<message-id>/`에 저장되며, `DISCORD_ATTACHMENT_MAX_BYTES`로 파일당 최대 크기를 제한한다.

## 로컬 개발

```bash
npm install
cp .env.example .env       # 토큰 채우기
npm run check              # 타입 검사
npm run dev                # tsx watch
npm run build              # tsc → dist/
node dist/index.js         # 빌드본 실행
```

`mju` / `openclaw` 바이너리가 `PATH`에 있어야 하며, `--app-dir`로 가리키는 vault 디렉토리(`USER_DATA_ROOT/<discord-id>`) 쓰기 권한도 필요하다. 운영 컨테이너에서는 `mjuclaw-setup`의 named volume과 같은 마운트 포인트를 공유한다.

## Docker

`Dockerfile`은 다음을 가정한다.
- Node 22 base.
- 빌드 시점에 `mju-cli`(빌드된 dist 또는 소스)를 `/opt/mju-cli`에 별도 COPY (multi-context build 또는 sibling clone). `mjuclaw-setup` 레포의 setup 스크립트가 이 단계를 책임지도록 통합 예정.
- `npm install -g openclaw@^2026.4.11`로 OpenClaw CLI 글로벌 설치 → router가 subprocess로 호출.
- `tini`로 PID 1, `router` 비루트 사용자.

## 운영 통합 (mjuclaw-setup)

별도 PR에서 `mjuclaw-setup/docker-compose.yml`에 `mjuclaw-router` 서비스를 추가하고, `mjuclaw-agent`의 Discord 채널 비활성화 + 봇 토큰 환경변수 이전 + cron 알림 helper 마이그레이션을 함께 처리한다. 이 레포 자체에서는 그 부분을 다루지 않는다.

## 라이선스

MIT.
