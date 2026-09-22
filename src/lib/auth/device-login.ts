/**
 * Device-code sign-in (RFC 8628), for machines with no browser: SSH boxes,
 * containers, CI runners a person is driving by hand.
 *
 * The backend hands out a short code; the person types it on the console's
 * `/device` page from any device (a phone will do) and approves; we poll
 * until then. An email with no account gets one on approval, so this is
 * also `lc login` for someone who has never opened the console.
 */

import * as os from 'node:os';
import type { ApiClient } from '../api/client.js';
import { ApiError, CliError, EXIT } from '../errors.js';
import type { LoginTokens } from './browser-login.js';

export const DEVICE_SIGN_IN_DENIED = 'DEVICE_SIGN_IN_DENIED';
export const DEVICE_SIGN_IN_EXPIRED = 'DEVICE_SIGN_IN_EXPIRED';
export const DEVICE_SIGN_IN_UNAVAILABLE = 'DEVICE_SIGN_IN_UNAVAILABLE';

interface StartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
  newAccount: boolean;
  emailSent: boolean;
}

type PollResponse =
  | { status: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' }
  | { status: 'approved'; token: string; refreshToken: string; user: { id: string; email: string } };

export interface DeviceFlow {
  userCode: string;
  verificationUrl: string;
  newAccount: boolean;
  emailSent: boolean;
  expiresAt: number;
  /** Resolves on approval; rejects with DEVICE_SIGN_IN_DENIED / _EXPIRED. */
  tokens: Promise<LoginTokens>;
  cancel(): void;
}

export async function startDeviceFlow(api: ApiClient, email: string): Promise<DeviceFlow> {
  let started: StartResponse;
  try {
    started = await api.post<StartResponse>(
      '/api/auth/device/start',
      { email, client: 'cli', clientName: `Light Cloud CLI on ${os.hostname()}` },
      { anonymous: true }
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new CliError('Device sign-in is not enabled on this Light Cloud environment.', {
        hint: 'Run `lc login` without --device to sign in through a browser.',
        code: DEVICE_SIGN_IN_UNAVAILABLE,
        exitCode: EXIT.ERROR,
      });
    }
    throw error;
  }

  const expiresAt = Date.now() + started.expiresIn * 1000;
  let cancelled = false;
  let timer: NodeJS.Timeout | null = null;

  const tokens = new Promise<LoginTokens>((resolve, reject) => {
    let delay = Math.max(started.interval, 3) * 1000;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > expiresAt) {
        reject(new CliError('The code expired before it was approved.', { code: DEVICE_SIGN_IN_EXPIRED, hint: 'Run `lc login` again for a new one.' }));
        return;
      }
      let answer: PollResponse | null = null;
      try {
        answer = await api.post<PollResponse>('/api/auth/device/poll', { deviceCode: started.deviceCode }, { anonymous: true });
      } catch {
        // Network blip: keep polling until the code expires.
      }
      if (answer) {
        switch (answer.status) {
          case 'approved':
            resolve({ accessToken: answer.token, refreshToken: answer.refreshToken });
            return;
          case 'access_denied':
            reject(new CliError('Sign-in was refused in the browser.', { code: DEVICE_SIGN_IN_DENIED }));
            return;
          case 'expired_token':
            reject(new CliError('The code expired before it was approved.', { code: DEVICE_SIGN_IN_EXPIRED, hint: 'Run `lc login` again for a new one.' }));
            return;
          case 'slow_down':
            delay += 5000;
            break;
          default:
            break;
        }
      }
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
  });

  return {
    userCode: started.userCode,
    verificationUrl: started.verificationUrl,
    newAccount: started.newAccount,
    emailSent: started.emailSent,
    expiresAt,
    tokens,
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
