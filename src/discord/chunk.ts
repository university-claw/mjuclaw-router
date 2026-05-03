const DISCORD_MESSAGE_LIMIT = 2000;

export function chunkForDiscord(
  text: string,
  limit = DISCORD_MESSAGE_LIMIT
): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= limit) {
      chunks.push(text.slice(cursor));
      break;
    }
    const window = text.slice(cursor, cursor + limit);
    const lastNewline = window.lastIndexOf("\n");
    const splitAt = lastNewline > limit / 2 ? lastNewline + 1 : limit;
    chunks.push(text.slice(cursor, cursor + splitAt));
    cursor += splitAt;
  }
  return chunks;
}
