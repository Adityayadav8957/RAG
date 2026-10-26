export interface SseMessage {
  event: string;
  data: string;
}

export interface SseParseResult {
  messages: SseMessage[];
  /** Unconsumed tail; pass it back as `buffer` with the next chunk. */
  rest: string;
}

/**
 * Pure incremental SSE parser. Feed it the leftover buffer plus the next decoded chunk.
 * Events are separated by a blank line; handles \r\n, \r and \n and events split across chunks.
 */
export function parseSse(buffer: string, chunk: string): SseParseResult {
  const text = (buffer + chunk).replace(/\r\n/g, "\n").replace(/\r(?!$)/g, "\n");
  const parts = text.split("\n\n");
  const rest = parts.pop() ?? "";
  const messages: SseMessage[] = [];
  for (const block of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}
