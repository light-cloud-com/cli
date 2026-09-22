/**
 * Interactive prompts, gated on having a terminal.
 *
 * Every prompt has a non-interactive answer: a flag the caller can pass, or
 * `--yes` for confirmations. Without a TTY the prompt is not shown; the CLI
 * either uses the flag or fails with a message naming the flag to pass.
 */

import * as clack from '@clack/prompts';
import { CancelledError, CliError, EXIT } from '../errors.js';
import { c, isInteractive, isJson, out } from './output.js';

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

function guard<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as T;
}

export function intro(title: string): void {
  if (!isInteractive()) return;
  clack.intro(title);
}

export function outro(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.outro(message);
}

export function note(message: string, title?: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    if (title) out(c.bold(title));
    out(message);
    return;
  }
  clack.note(message, title);
}

export function logStep(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.step(message);
}

export function logMessage(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.message(message);
}

export function logInfo(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.info(message);
}

export function logSuccess(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.success(message);
}

export function logWarn(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.warn(message);
}

export function logError(message: string): void {
  if (isJson()) return;
  if (!isInteractive()) {
    out(message);
    return;
  }
  clack.log.error(message);
}

export async function select<T extends string>(
  message: string,
  options: SelectOption<T>[],
  config: { flag: string; initialValue?: T }
): Promise<T> {
  if (!isInteractive()) {
    throw new CliError(`${message} — no terminal to ask in.`, {
      hint: `Pass ${config.flag} to choose without a prompt.`,
      exitCode: EXIT.USAGE,
      code: 'NON_INTERACTIVE',
    });
  }
  if (options.length === 0) {
    throw new CliError(`${message} — nothing to choose from.`, { exitCode: EXIT.NOT_FOUND });
  }
  const value = await clack.select<T>({
    message,
    options: options.map((option) => ({ value: option.value, label: option.label, hint: option.hint })) as clack.Option<T>[],
    initialValue: config.initialValue,
    maxItems: 12,
  });
  return guard(value);
}

export async function confirm(
  message: string,
  config: { yes: boolean; initialValue?: boolean; flag?: string }
): Promise<boolean> {
  if (config.yes) return true;
  if (!isInteractive()) {
    throw new CliError(`${message} — no terminal to confirm in.`, {
      hint: `Pass ${config.flag ?? '--yes'} to confirm without a prompt.`,
      exitCode: EXIT.USAGE,
      code: 'NON_INTERACTIVE',
    });
  }
  const value = await clack.confirm({ message, initialValue: config.initialValue ?? false });
  return guard(value);
}

export async function text(
  message: string,
  config: { flag: string; placeholder?: string; initialValue?: string; validate?: (value: string) => string | undefined }
): Promise<string> {
  if (!isInteractive()) {
    throw new CliError(`${message} — no terminal to ask in.`, {
      hint: `Pass ${config.flag} to provide the value.`,
      exitCode: EXIT.USAGE,
      code: 'NON_INTERACTIVE',
    });
  }
  const value = await clack.text({
    message,
    placeholder: config.placeholder,
    initialValue: config.initialValue,
    validate: config.validate
      ? (input) => {
          const result = config.validate?.(String(input ?? ''));
          return result ? result : undefined;
        }
      : undefined,
  });
  return guard(value);
}

export async function password(message: string, config: { flag: string }): Promise<string> {
  if (!isInteractive()) {
    throw new CliError(`${message} — no terminal to ask in.`, {
      hint: `Pass ${config.flag} to provide the value.`,
      exitCode: EXIT.USAGE,
      code: 'NON_INTERACTIVE',
    });
  }
  const value = await clack.password({ message });
  return guard(value);
}

export interface Spinner {
  start(message: string): void;
  message(message: string): void;
  stop(message?: string, code?: number): void;
}

/**
 * A spinner in a terminal; plain lines everywhere else, so CI logs still show
 * what happened and when.
 */
export function spinner(): Spinner {
  if (isInteractive()) {
    const s = clack.spinner();
    return {
      start: (message) => s.start(message),
      message: (message) => s.message(message),
      stop: (message, code) => {
        if (code === 1) s.error(message);
        else if (code === 2) s.cancel(message);
        else s.stop(message);
      },
    };
  }
  let current = '';
  return {
    start: (message) => {
      current = message;
      if (!isJson()) out(`${c.dim('…')} ${message}`);
    },
    message: (message) => {
      if (message !== current) {
        current = message;
        if (!isJson()) out(`${c.dim('…')} ${message}`);
      }
    },
    stop: (message, code) => {
      if (isJson() || !message) return;
      const glyph = code === 1 ? c.red('✖') : code === 2 ? c.yellow('▲') : c.green('✔');
      out(`${glyph} ${message}`);
    },
  };
}
