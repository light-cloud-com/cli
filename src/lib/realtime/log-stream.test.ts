import { describe, expect, it } from 'vitest';
import { parseFrame, readSse } from './log-stream.js';

describe('SSE parsing', () => {
  it('parses a data frame', () => {
    expect(parseFrame('data: {"type":"heartbeat","timestamp":"t"}')).toEqual({ type: 'heartbeat', timestamp: 't' });
  });

  it('ignores comments and malformed frames', () => {
    expect(parseFrame(': keep-alive')).toBeNull();
    expect(parseFrame('data: not json')).toBeNull();
  });

  it('reads frames split across chunks', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"log","entry":{"insertId":"1","timestamp":"t","severity":"INFO","textPayload":"a"}}\n\ndata: {"ty'));
        controller.enqueue(encoder.encode('pe":"heartbeat"}\n\n'));
        controller.close();
      },
    });
    const response = new Response(body);
    const updates = [];
    for await (const update of readSse(response)) updates.push(update);
    expect(updates.map((u) => u.type)).toEqual(['log', 'heartbeat']);
    expect(updates[0]?.entry?.textPayload).toBe('a');
  });
});
