/**
 * HTTP client for the Light Cloud API.
 *
 * Handles the three things every call needs and nothing else: the right
 * credential, one silent token refresh when a session has expired, and API
 * failures turned into errors a person can read.
 */

import { ApiError, CliError, EXIT, notLoggedIn } from '../errors.js';
import {
  isApiKey,
  readCredentials,
  resolveAuth,
  updateCredentials,
  type AuthSource,
} from '../auth/credentials.js';
import type { Endpoints } from '../config/global-config.js';
import { USER_AGENT } from '../version.js';

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Send without credentials (login, public config). */
  anonymous?: boolean;
  /** Abort the request when this fires. */
  signal?: AbortSignal;
}

interface ErrorBody {
  code?: string;
  message?: string;
  error?: string;
  /** The backend's own "what unblocks this" (MCP tool names); mapped to lc commands below. */
  nextStep?: string;
}

/** Backend `nextStep` values → the lc command that does the same thing. */
const NEXT_STEP_HINTS: Record<string, string> = {
  'choose-plan': 'Change plan with `lc billing plans` then `lc billing plan use <id>`.',
  'add-payment-method': 'Add a card with `lc billing card add`.',
};

export class ApiClient {
  readonly endpoints: Endpoints;
  private refreshing: Promise<boolean> | null = null;

  constructor(endpoints: Endpoints) {
    this.endpoints = endpoints;
  }

  authSource(): AuthSource {
    return resolveAuth().source;
  }

  /** True when a credential is present. Whether it still works is for the API to say. */
  hasCredentials(): boolean {
    return resolveAuth().token !== null;
  }

  usingApiKey(): boolean {
    return isApiKey(resolveAuth().token);
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.json<T>('GET', path, options);
  }

  async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.json<T>('POST', path, { ...options, body });
  }

  async put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.json<T>('PUT', path, { ...options, body });
  }

  async delete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.json<T>('DELETE', path, { ...options, body });
  }

  /**
   * A raw response for streaming bodies (SSE log tails, database dumps).
   * The caller owns the body; errors are still raised as ApiError.
   */
  async stream(path: string, options: RequestOptions & { method?: string } = {}): Promise<Response> {
    const { method = 'GET', ...rest } = options;
    const response = await this.send(method, path, {
      ...rest,
      headers: { Accept: 'text/event-stream, application/octet-stream, */*', ...rest.headers },
    });
    if (!response.ok) throw await this.toApiError(response);
    return response;
  }

  private async json<T>(method: string, path: string, options: RequestOptions): Promise<T> {
    const response = await this.send(method, path, options);
    if (!response.ok) throw await this.toApiError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(`The API returned something that is not JSON (${response.status}).`, {
        hint: `Check that ${this.endpoints.apiUrl} is a Light Cloud API URL.`,
      });
    }
  }

  private async send(method: string, path: string, options: RequestOptions, retried = false): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      'X-Client-Type': 'cli',
      ...options.headers,
    };
    const rawBody = options.body instanceof Uint8Array || options.body instanceof ArrayBuffer;
    if (options.body !== undefined && !rawBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    if (!options.anonymous) {
      const auth = resolveAuth();
      if (!auth.token) throw notLoggedIn();
      headers.Authorization = `Bearer ${auth.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : rawBody ? (options.body as unknown as BodyInit) : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = error instanceof Error ? (error.cause as Error | undefined)?.message || error.message : String(error);
      throw new CliError(`Could not reach ${this.endpoints.apiUrl} (${reason}).`, {
        hint: 'Check your network connection, or set --api-url if you use a different endpoint.',
        code: 'NETWORK',
        cause: error,
      });
    }

    // A session token that has expired gets one refresh; an API key never does.
    if (response.status === 401 && !options.anonymous && !retried && !this.usingApiKey()) {
      const refreshed = await this.refreshSession();
      if (refreshed) return this.send(method, path, options, true);
    }
    return response;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.startsWith('http') ? path : `${this.endpoints.apiUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async refreshSession(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const { refreshToken } = readCredentials();
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${this.endpoints.apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-Client-Type': 'cli',
        },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { token?: string; accessToken?: string; refreshToken?: string };
      const accessToken = data.token || data.accessToken;
      if (!accessToken) return false;
      // The refresh endpoint rotates: the old refresh token is revoked, so the
      // new one must be stored or the next refresh fails.
      updateCredentials({ accessToken, refreshToken: data.refreshToken || refreshToken });
      return true;
    } catch {
      return false;
    }
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // not JSON
    }
    const message = body.message || body.error || response.statusText || `HTTP ${response.status}`;
    const code = body.code || `HTTP_${response.status}`;

    if (response.status === 401) {
      const hint = this.usingApiKey()
        ? 'The API key was rejected. It may be revoked, expired, or from another environment.'
        : 'Your session has expired. Run `lc login` to sign in again.';
      return new ApiError(401, code, 'Authentication failed.', hint);
    }
    const nextStep = body.nextStep ? NEXT_STEP_HINTS[body.nextStep] : undefined;
    if (response.status === 402) {
      return new ApiError(402, code, message, nextStep ?? 'This needs a paid plan. Manage plans with `lc billing plans`.');
    }
    if (response.status === 403) {
      return new ApiError(
        403,
        code,
        message,
        nextStep ?? 'Your role in this workspace does not allow it, or the resource belongs to another workspace.'
      );
    }
    if (response.status === 429) {
      return new ApiError(429, code, 'Too many requests.', 'Wait a moment and try again.');
    }
    return new ApiError(response.status, code, message, nextStep);
  }
}

export function assertExit(error: unknown): never {
  if (error instanceof CliError) throw error;
  throw new CliError(error instanceof Error ? error.message : String(error), { exitCode: EXIT.ERROR, cause: error });
}
