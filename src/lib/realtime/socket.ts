/**
 * Live updates over Socket.IO, the same channel the console uses.
 *
 * The API emits `environment:update`, `application:update` and
 * `database:update` into per-resource rooms; a client joins a room with
 * `subscribe`. Connection problems are reported, never thrown: a watcher
 * always has polling to fall back on.
 */

import { io, type Socket } from 'socket.io-client';

export type ResourceKind = 'environment' | 'application' | 'database' | 'organisation';

export interface LiveConnection {
  socket: Socket;
  subscribe(kind: ResourceKind, id: string): void;
  onEvent<T>(event: string, handler: (data: T) => void): () => void;
  close(): void;
}

export function connectLive(socketUrl: string, token: string | null, options: { timeoutMs?: number } = {}): Promise<LiveConnection | null> {
  return new Promise((resolve) => {
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: options.timeoutMs ?? 8000,
    });

    const subscriptions: Array<{ kind: ResourceKind; id: string }> = [];
    let settled = false;

    const connection: LiveConnection = {
      socket,
      subscribe(kind, id) {
        subscriptions.push({ kind, id });
        if (socket.connected) socket.emit('subscribe', { type: kind, id });
      },
      onEvent(event, handler) {
        socket.on(event, handler as (...args: unknown[]) => void);
        return () => socket.off(event, handler as (...args: unknown[]) => void);
      },
      close() {
        socket.removeAllListeners();
        socket.disconnect();
      },
    };

    socket.on('connect', () => {
      // Rooms do not survive a reconnect on the server side.
      for (const sub of subscriptions) socket.emit('subscribe', { type: sub.kind, id: sub.id });
      if (!settled) {
        settled = true;
        resolve(connection);
      }
    });

    socket.on('connect_error', () => {
      if (!settled) {
        settled = true;
        socket.disconnect();
        resolve(null);
      }
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.disconnect();
        resolve(null);
      }
    }, (options.timeoutMs ?? 8000) + 500);
    timer.unref();
  });
}
