/**
 * Errors the CLI raises on purpose.
 *
 * Every failure a user can act on is a CliError: the message says what went
 * wrong, the hint says what to do about it, and the exit code lets scripts
 * branch without parsing text.
 */

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  FAILED: 5,
  CANCELLED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliErrorOptions {
  hint?: string;
  exitCode?: ExitCode;
  code?: string;
  cause?: unknown;
}

export class CliError extends Error {
  readonly hint?: string;
  readonly exitCode: ExitCode;
  readonly code: string;

  constructor(message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? EXIT.ERROR;
    this.code = options.code ?? 'ERROR';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class CancelledError extends CliError {
  constructor() {
    super('Cancelled.', { exitCode: EXIT.CANCELLED, code: 'CANCELLED' });
    this.name = 'CancelledError';
  }
}

/** A response the API refused. `status` is the HTTP status it came back with. */
export class ApiError extends CliError {
  readonly status: number;

  constructor(status: number, code: string, message: string, hint?: string) {
    super(message, {
      code,
      hint,
      exitCode:
        status === 401 ? EXIT.AUTH : status === 404 ? EXIT.NOT_FOUND : EXIT.ERROR,
    });
    this.name = 'ApiError';
    this.status = status;
  }
}

export const notLoggedIn = (): CliError =>
  new CliError('You are not signed in to Light Cloud.', {
    hint: 'Run `lc login`, or set LIGHT_CLOUD_API_KEY for unattended use.',
    exitCode: EXIT.AUTH,
    code: 'UNAUTHENTICATED',
  });
