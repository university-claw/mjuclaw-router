import http from "node:http";

import {
  ChannelType,
  type Client,
  type DMChannel,
  PollLayoutType,
  type User,
} from "discord.js";

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

type PollBody = {
  discordUserId?: unknown;
  question?: unknown;
  answers?: unknown;
  durationHours?: unknown;
  allowMultiselect?: unknown;
};

const MAX_BODY_BYTES = 1024 * 64;
const MAX_POLL_QUESTION_LEN = 300;
const MAX_POLL_ANSWER_LEN = 55;
const MAX_POLL_ANSWERS = 10;

// 내부 helper에서 사용 — bin/mju-onboarding-survey + view-server post-login flow.
// 모든 핸들러는 동일한 Bearer 토큰(HTTP_AUTH_TOKEN)으로 인증한다.
export function createHttpServer(opts: HttpServerOptions): http.Server {
  const { port, bindHost, authToken, client, logger } = opts;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";

    if (req.method === "GET" && url === "/healthz") {
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

    if (req.method === "POST" && url === "/discord/send") {
      handleSend(req, res, { client, logger, authToken });
      return;
    }

    if (req.method === "POST" && url === "/discord/poll") {
      handlePoll(req, res, { client, logger, authToken });
      return;
    }

    if (req.method === "GET" && url.startsWith("/discord/messages")) {
      handleListMessages(req, res, { client, logger, authToken });
      return;
    }

    if (req.method === "DELETE" && url.startsWith("/discord/messages")) {
      handleDeleteMessage(req, res, { client, logger, authToken });
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

// POST /discord/send — DM 1건 발송. 기존 호출자(news-alert/attendance-alert) 호환을
// 위해 200 응답 본문은 {ok:true, channelId, messageId, additionalMessageIds[]} 형태.
// content가 chunk되면 첫 메시지 id를 messageId로 두고 나머지는 additionalMessageIds로.
async function handleSend(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { client: Client; logger: Logger; authToken: string }
) {
  const { client, logger, authToken } = ctx;
  if (!verifyAuth(req, authToken)) return respond(res, 401, { ok: false, reason: "unauthorized" });

  let parsed: SendBody;
  try {
    parsed = (await readJsonBody(req)) as SendBody;
  } catch (err) {
    return respond(res, 413, { ok: false, reason: "payload_too_large_or_invalid" });
  }

  const discordUserId = typeof parsed.discordUserId === "string" ? parsed.discordUserId.trim() : "";
  const content = typeof parsed.content === "string" ? parsed.content : "";

  if (!isValidDiscordId(discordUserId)) return respond(res, 400, { ok: false, reason: "invalid_discordUserId" });
  if (!content) return respond(res, 400, { ok: false, reason: "empty_content" });

  if (!client.isReady()) return respond(res, 503, { ok: false, reason: "discord_not_ready" });

  let user: User;
  try {
    user = await client.users.fetch(discordUserId);
  } catch (err) {
    logger.warn({ discordUserId, err: String(err) }, "users.fetch 실패");
    return respond(res, 502, { ok: false, reason: "user_fetch_failed" });
  }

  const messageIds: string[] = [];
  let channelId: string | undefined;
  try {
    for (const chunk of chunkForDiscord(content)) {
      const sent = await user.send({ content: chunk });
      messageIds.push(sent.id);
      channelId ??= sent.channelId;
    }
  } catch (err) {
    logger.warn({ discordUserId, err: String(err) }, "DM 전송 실패");
    return respond(res, 502, { ok: false, reason: "dm_send_failed" });
  }

  logger.info({ discordUserId, contentBytes: content.length, messageCount: messageIds.length }, "DM 전송 성공");
  return respond(res, 200, {
    ok: true,
    channelId,
    messageId: messageIds[0],
    additionalMessageIds: messageIds.slice(1),
  });
}

// POST /discord/poll — DM에 Discord Poll 발사.
// body: {discordUserId, question, answers[], durationHours, allowMultiselect?}
// 응답: {ok, channelId, messageId}
async function handlePoll(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { client: Client; logger: Logger; authToken: string }
) {
  const { client, logger, authToken } = ctx;
  if (!verifyAuth(req, authToken)) return respond(res, 401, { ok: false, reason: "unauthorized" });

  let parsed: PollBody;
  try {
    parsed = (await readJsonBody(req)) as PollBody;
  } catch {
    return respond(res, 413, { ok: false, reason: "payload_too_large_or_invalid" });
  }

  const discordUserId =
    typeof parsed.discordUserId === "string" ? parsed.discordUserId.trim() : "";
  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  const answersRaw = Array.isArray(parsed.answers) ? parsed.answers : [];
  const answers = answersRaw
    .map((a) => (typeof a === "string" ? a.trim() : ""))
    .filter((a) => a.length > 0);
  const durationHours =
    typeof parsed.durationHours === "number" && Number.isFinite(parsed.durationHours)
      ? parsed.durationHours
      : 1;
  const allowMultiselect = parsed.allowMultiselect === true;

  if (!isValidDiscordId(discordUserId))
    return respond(res, 400, { ok: false, reason: "invalid_discordUserId" });
  if (!question || question.length > MAX_POLL_QUESTION_LEN)
    return respond(res, 400, { ok: false, reason: "invalid_question" });
  if (answers.length < 1 || answers.length > MAX_POLL_ANSWERS)
    return respond(res, 400, { ok: false, reason: "invalid_answers" });
  if (answers.some((a) => a.length > MAX_POLL_ANSWER_LEN))
    return respond(res, 400, { ok: false, reason: "answer_too_long" });
  if (durationHours < 1 || durationHours > 768)
    return respond(res, 400, { ok: false, reason: "invalid_durationHours" });

  if (!client.isReady()) return respond(res, 503, { ok: false, reason: "discord_not_ready" });

  let user: User;
  try {
    user = await client.users.fetch(discordUserId);
  } catch (err) {
    logger.warn({ discordUserId, err: String(err) }, "users.fetch 실패");
    return respond(res, 502, { ok: false, reason: "user_fetch_failed" });
  }

  try {
    const sent = await user.send({
      poll: {
        question: { text: question },
        answers: answers.map((text) => ({ text })),
        duration: durationHours,
        allowMultiselect,
        layoutType: PollLayoutType.Default,
      },
    });
    logger.info(
      { discordUserId, question, answers: answers.length, durationHours, allowMultiselect },
      "Poll 발사"
    );
    return respond(res, 200, {
      ok: true,
      channelId: sent.channelId,
      messageId: sent.id,
    });
  } catch (err) {
    logger.warn({ discordUserId, err: String(err) }, "Poll 발사 실패");
    return respond(res, 502, { ok: false, reason: "poll_send_failed" });
  }
}

// GET /discord/messages?channelId=X&limit=N — 채널 최근 메시지(+poll results) 조회.
// limit 1..50. survey collect가 poll vote 집계용으로 사용.
async function handleListMessages(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { client: Client; logger: Logger; authToken: string }
) {
  const { client, logger, authToken } = ctx;
  if (!verifyAuth(req, authToken)) return respond(res, 401, { ok: false, reason: "unauthorized" });

  const params = parseQuery(req.url ?? "");
  const channelId = (params.get("channelId") ?? "").trim();
  const limitRaw = params.get("limit");
  const limit = clampInt(limitRaw, 1, 50, 25);

  if (!isValidDiscordId(channelId))
    return respond(res, 400, { ok: false, reason: "invalid_channelId" });
  if (!client.isReady()) return respond(res, 503, { ok: false, reason: "discord_not_ready" });

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    logger.warn({ channelId, err: String(err) }, "channels.fetch 실패");
    return respond(res, 502, { ok: false, reason: "channel_fetch_failed" });
  }

  if (!channel || channel.type !== ChannelType.DM) {
    return respond(res, 400, { ok: false, reason: "channel_not_dm" });
  }

  try {
    const collection = await (channel as DMChannel).messages.fetch({ limit });
    const messages = collection.map((m) => ({
      id: m.id,
      authorId: m.author?.id,
      content: m.content,
      poll: m.poll
        ? {
            question: { text: m.poll.question.text },
            answers: m.poll.answers.map((a) => ({
              id: a.id,
              text: a.text ?? null,
              voteCount: a.voteCount ?? 0,
            })),
            resultsFinalized: m.poll.resultsFinalized,
            allowMultiselect: m.poll.allowMultiselect,
            expiresTimestamp: m.poll.expiresTimestamp,
          }
        : null,
      createdTimestamp: m.createdTimestamp,
    }));
    return respond(res, 200, { ok: true, channelId, messages });
  } catch (err) {
    logger.warn({ channelId, err: String(err) }, "messages.fetch 실패");
    return respond(res, 502, { ok: false, reason: "messages_fetch_failed" });
  }
}

// DELETE /discord/messages?channelId=X&messageId=M — 봇이 보낸 메시지 1건 삭제.
async function handleDeleteMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: { client: Client; logger: Logger; authToken: string }
) {
  const { client, logger, authToken } = ctx;
  if (!verifyAuth(req, authToken)) return respond(res, 401, { ok: false, reason: "unauthorized" });

  const params = parseQuery(req.url ?? "");
  const channelId = (params.get("channelId") ?? "").trim();
  const messageId = (params.get("messageId") ?? "").trim();

  if (!isValidDiscordId(channelId))
    return respond(res, 400, { ok: false, reason: "invalid_channelId" });
  if (!isValidDiscordId(messageId))
    return respond(res, 400, { ok: false, reason: "invalid_messageId" });
  if (!client.isReady()) return respond(res, 503, { ok: false, reason: "discord_not_ready" });

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    logger.warn({ channelId, err: String(err) }, "channels.fetch 실패");
    return respond(res, 502, { ok: false, reason: "channel_fetch_failed" });
  }
  if (!channel || channel.type !== ChannelType.DM) {
    return respond(res, 400, { ok: false, reason: "channel_not_dm" });
  }

  try {
    await (channel as DMChannel).messages.delete(messageId);
    return respond(res, 200, { ok: true });
  } catch (err) {
    logger.warn({ channelId, messageId, err: String(err) }, "messages.delete 실패");
    return respond(res, 502, { ok: false, reason: "message_delete_failed" });
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function isValidDiscordId(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function clampInt(raw: string | null, min: number, max: number, def: number): number {
  if (raw === null) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
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

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const raw = await readBody(req, MAX_BODY_BYTES);
  if (!raw) return {};
  return JSON.parse(raw);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
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
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
