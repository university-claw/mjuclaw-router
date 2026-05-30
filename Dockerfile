# mjuclaw-router — OpenClaw 앞단의 Discord WS 라우터.
# 100% rule-base 온보딩 게이트 + LLM 응답 forward + cron alert 우회용 HTTP 서버.
#
# 빌드 시 `mju-cli`/`mju-news` 소스가 필요하므로 docker buildx의 additional_contexts로
# 외부에서 주입한다 (compose 측 build.additional_contexts 설정 참고).

# ── stage 1: mju-cli 빌드 ───────────────────────────────────────
FROM node:22-slim AS mju-cli-build
WORKDIR /opt/mju-cli
COPY --from=mju-cli package.json package-lock.json ./
RUN npm ci --include=dev
COPY --from=mju-cli . ./
RUN npx tsc && npm prune --omit=dev

# ── stage 2: mju-news 빌드 ──────────────────────────────────────
FROM node:22-slim AS mju-news-build
WORKDIR /opt/mju-news
COPY --from=mju-news package.json package-lock.json ./
RUN npm ci --include=dev
COPY --from=mju-news . ./
RUN npx tsc && npm prune --omit=dev

# ── stage 3: router 빌드 ────────────────────────────────────────
FROM node:22-slim AS router-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

# ── stage 4: runtime ────────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 tini \
    && rm -rf /var/lib/apt/lists/*

# OpenClaw CLI — router가 `openclaw agent --json`을 subprocess로 호출해
# mjuclaw-agent 컨테이너의 gateway에 forward하는 용도.
RUN npm install -g openclaw@2026.4.11 \
    && openclaw --version

WORKDIR /app
COPY --from=mju-cli-build /opt/mju-cli /opt/mju-cli
COPY --from=mju-news-build /opt/mju-news /opt/mju-news
COPY --from=router-build /app/node_modules ./node_modules
COPY --from=router-build /app/dist ./dist
COPY package.json ./

# 슬림 mju 래퍼 — agent의 view-server 의존 래퍼와 달리 router는 view 자동 POST가
# 필요 없으므로 단순 forwarder만 둔다 (mju-cli main entry는 shebang이 없어서
# `node` prefix 필수).
RUN printf '#!/bin/bash\nexec node /opt/mju-cli/dist/main.js "$@"\n' > /usr/local/bin/mju \
    && chmod +x /usr/local/bin/mju

RUN printf '#!/bin/bash\nexec node /opt/mju-news/dist/main.js "$@"\n' > /usr/local/bin/mju-news \
    && chmod +x /usr/local/bin/mju-news

COPY bin/mju-academic-planning /usr/local/bin/mju-academic-planning
COPY bin/mju-timetable-planner /usr/local/bin/mju-timetable-planner
COPY bin/mju-graduation-roadmap /usr/local/bin/mju-graduation-roadmap
RUN chmod +x /usr/local/bin/mju-academic-planning \
    /usr/local/bin/mju-timetable-planner \
    /usr/local/bin/mju-graduation-roadmap

# 비루트 사용자 (uid 999는 mjuclaw-agent의 agent 유저와 일치 — 공유 user-data 볼륨
# 권한 매칭용). mju-cli vault 디렉토리 쓰기 권한이 router에도 있어야 한다.
# /home/router/.openclaw는 named volume 마운트 포인트로 사용되며, 이미지에 미리
# 만들어 두면 named volume 첫 생성 시 권한이 그대로 보존된다.
RUN groupadd --system --gid 999 router \
    && useradd --system --uid 999 --gid router --create-home router \
    && mkdir -p /home/router/.openclaw \
    && chown -R router:router /app /opt/mju-cli /opt/mju-news /home/router/.openclaw \
    && chmod 700 /home/router/.openclaw

USER router

ENV LOG_LEVEL=info \
    USER_DATA_ROOT=/data/users \
    OPENCLAW_GATEWAY_URL=ws://mjuclaw-agent:18789 \
    VIEW_SERVER_URL=http://mjuclaw-agent:3001 \
    HTTP_PORT=3100 \
    HTTP_BIND_HOST=0.0.0.0

EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/index.js"]
