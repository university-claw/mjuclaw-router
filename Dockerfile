# mjuclaw-router — OpenClaw 앞단의 Discord WS 라우터.
# 100% rule-base 온보딩 게이트 + LLM 응답 forward를 담당.
FROM node:22-slim AS base

ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# ── mju-cli 번들 (subprocess 호출용) ──────────────────────────────
# 빌드 컨텍스트 루트 외부 경로를 쓰지 않기 위해 build 시점에 mju-cli/dist를
# `mjuclaw-setup` 패턴과 동일하게 외부에서 별도 COPY 하도록 한다. 자세한 빌드
# 가이드는 README.md 참고.
WORKDIR /opt/mju-cli
# COPY mju-cli/ /opt/mju-cli/   ← 실제 빌드 시 setup 레포에서 이 단계를 추가하거나,
# multi-context build로 별도 sibling 디렉토리에서 가져옴.

# ── openclaw CLI ────────────────────────────────────────────────
# 가장 가벼운 통합: gateway WS endpoint를 향해 `openclaw agent --json`만 호출하면 되므로
# CLI 패키지를 글로벌 설치한다. mjuclaw-setup의 mju-cli 빌드와 동일한 npm 레지스트리 가정.
RUN npm install -g openclaw@^2026.4.11 \
    && openclaw --version

# ── router 본체 ─────────────────────────────────────────────────
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install --include=dev typescript \
    && npx tsc -p tsconfig.json \
    && npm prune --omit=dev

# 비루트 사용자
RUN groupadd --system --gid 999 router \
    && useradd --system --uid 999 --gid router --create-home router \
    && chown -R router:router /app
USER router

ENV LOG_LEVEL=info \
    USER_DATA_ROOT=/data/users \
    OPENCLAW_GATEWAY_URL=ws://mjuclaw-agent:18789

ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/index.js"]
