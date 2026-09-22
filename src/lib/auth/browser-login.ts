/**
 * Browser sign-in.
 *
 * The CLI listens on a loopback port, sends the browser to the console's
 * `/auth/cli` page with that port as the callback, and the console redirects
 * back with the tokens once the person has signed in — or with
 * `error=cancelled` when they decline, so the terminal stops waiting. The
 * listener then sends the browser back to the console's `/auth/cli?done=…`
 * page for the closing screen, so no HTML lives here. The console only ever
 * redirects to loopback hosts, and the `state` value ties the redirect to
 * this particular attempt.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CliError, EXIT } from '../errors.js';

export interface LoginTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface LoginFlow {
  /** URL to open in a browser. */
  url: string;
  /** Resolves when the browser comes back, rejects on cancel, error or timeout. */
  tokens: Promise<LoginTokens>;
  /** Stop waiting and release the port. */
  cancel(): void;
}

export const SIGN_IN_CANCELLED = 'SIGN_IN_CANCELLED';

export function startLoginFlow(consoleUrl: string, options: { timeoutMs?: number } = {}): Promise<LoginFlow> {
  const state = crypto.randomBytes(16).toString('hex');
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  return new Promise((resolveFlow, rejectFlow) => {
    let settle: { resolve: (tokens: LoginTokens) => void; reject: (error: Error) => void } | null = null;
    const tokens = new Promise<LoginTokens>((resolve, reject) => {
      settle = { resolve, reject };
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      const error = url.searchParams.get('error');
      const token = url.searchParams.get('token');
      const refreshToken = url.searchParams.get('refreshToken') || undefined;
      const returnedState = url.searchParams.get('state');

      // The closing page lives in the console (same component as every
      // other hand-off page); this listener only reports the outcome.
      const finish = (kind: 'success' | 'cancelled' | 'error', message?: string) => {
        const target = new URL(`${consoleUrl}/auth/cli`);
        target.searchParams.set('done', kind);
        target.searchParams.set('client', 'cli');
        if (message) target.searchParams.set('message', message);
        res.writeHead(302, { Location: target.toString() });
        res.end();
        server.close();
      };

      if (error === 'cancelled') {
        finish('cancelled');
        settle?.reject(new CliError('Sign-in cancelled in the browser.', { exitCode: EXIT.CANCELLED, code: SIGN_IN_CANCELLED }));
        return;
      }
      if (error) {
        finish('error', error);
        settle?.reject(new CliError(`Sign-in failed: ${error}`, { exitCode: EXIT.AUTH }));
        return;
      }
      if (returnedState !== state) {
        finish('error', 'This sign-in link does not match the one the CLI is waiting for.');
        settle?.reject(new CliError('Sign-in state mismatch. Start again with `lc login`.', { exitCode: EXIT.AUTH }));
        return;
      }
      if (!token) {
        finish('error', 'No token was received from the console.');
        settle?.reject(new CliError('The console sent no token back.', { exitCode: EXIT.AUTH }));
        return;
      }
      finish('success');
      settle?.resolve({ accessToken: token, refreshToken });
    });

    server.on('error', (error) => rejectFlow(new CliError(`Could not start the sign-in listener: ${error.message}`)));

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const callback = `http://127.0.0.1:${port}/callback`;
      const url = `${consoleUrl}/auth/cli?callback=${encodeURIComponent(callback)}&state=${state}`;

      const timer = setTimeout(() => {
        server.close();
        settle?.reject(new CliError('Sign-in timed out after 5 minutes.', { hint: 'Run `lc login` again.', exitCode: EXIT.AUTH }));
      }, timeoutMs);
      timer.unref();

      resolveFlow({
        url,
        tokens: tokens.finally(() => clearTimeout(timer)),
        cancel: () => {
          clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}
