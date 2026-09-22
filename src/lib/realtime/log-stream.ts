/**
 * Read a server-sent-events body as a stream of parsed updates.
 */

import type { LogStreamUpdate } from '../api/types.js';

export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<LogStreamUpdate> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export function parseFrame(frame: string): LogStreamUpdate | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data) as LogStreamUpdate;
  } catch {
    return null;
  }
}
