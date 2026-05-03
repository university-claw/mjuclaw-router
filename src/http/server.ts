import http from "node:http";

import type { Client, User } from "discord.js";

import type { Logger } from "../logger.js";
import { chunkForDiscord } from "../discord/chunk.js";

export type HttpServerOptions = {
  port: number;
  bindHost: string;
  authToken: string;
  client: Client;
  logger: Logger;
};

type SendBody = {
  discordUserId?: unknown;
  content?: unknown;
};

const MAX_BODY_BYTES = 1024 * 64;

export function createHttpServer(opts: HttpServerOptions): http.Server {
  const { port, bindHost, authToken, client, logger } = opts;

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          discordReady: client.isReady(),
          ...(client.user ? { botId: client.user.id, botTag: client.user.tag } : {}),
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/discord/send") {
      handleSend(req, res, { client, logger, authToken });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: "not_found" }));
  });

  server.listen(port, bindHost, () => {
    logger.info({ port, bindHost }, "HTTP server listening");
  });

  return server;
}

async function handleSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { client: Client; logger: Logger; authToken: string }
) {
  const { client, logger, authToken } = ctx;

  if (!verifyAuth(req, authToken)) {
    respond(res, 401, { ok: false, reason: "unauthorized" });
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    logger.warn({ err: String(err) }, "send: 본문 읽기 실패");
    respond(res, 413, { ok: false, reason: "payload_too_large_or_unreadable" });
    return;
  }

  let parsed: SendBody;
  try {
    parsed = JSON.parse(raw) as SendBody;
  } catch {
    respond(res, 400, { ok: false, reason: "invalid_json" });
    return;
  }

  const discordUserId =
    typeof parsed.discordUserId === "string" ? parsed.discordUserId.trim() : "";
  const content = typeof parsed.content === "string" ? parsed.content : "";

  if (!discordUserId || !/^\d{17,20}$/.test(discordUserId)) {
    respond(res, 400, { ok: false, reason: "invalid_discordUserId" });
    return;
  }
  if (!content || content.length === 0) {
    respond(res, 400, { ok: false, reason: "empty_content" });
    return;
  }

  if (!client.isReady()) {
    respond(res, 503, { ok: false, reason: "discord_not_ready" });
    return;
  }

  let user: User;
  try {
    user = await client.users.fetch(discordUserId);
  } catch (err) {
    logger.warn(
      { discordUserId, err: String(err) },
      "users.fetch 실패"
    );
    respond(res, 502, { ok: false, reason: "user_fetch_failed" });
    return;
  }

  try {
    const chunks = chunkForDiscord(content);
    for (const chunk of chunks) {
      await user.send({ content: chunk });
    }
  } catch (err) {
    logger.warn(
      { discordUserId, err: String(err) },
      "DM 전송 실패 (사용자가 봇 차단 또는 DM 비허용 가능)"
    );
    respond(res, 502, { ok: false, reason: "dm_send_failed" });
    return;
  }

  logger.info(
    { discordUserId, contentBytes: content.length },
    "DM 전송 성공"
  );
  respond(res, 200, { ok: true });
}

function verifyAuth(req: http.IncomingMessage, expected: string): boolean {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string") return false;
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m || !m[1]) return false;
  return constantTimeEqual(m[1], expected);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function readBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function respond(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
