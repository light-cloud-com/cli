/**
 * Everything the CLI prints goes through here.
 *
 * Two modes. Human mode writes styled text to stdout. JSON mode (`--json`)
 * writes exactly one JSON document to stdout and keeps every decoration off
 * it, so `lc apps --json | jq` works without stripping anything. Diagnostics
 * always go to stderr.
 */

import pc from 'picocolors';

type Colors = ReturnType<typeof pc.createColors>;

interface OutputState {
  json: boolean;
  color: boolean;
  quiet: boolean;
}

const state: OutputState = {
  json: false,
  color: pc.isColorSupported,
  quiet: false,
};

let palette: Colors = pc.createColors(state.color);

export function configureOutput(options: Partial<OutputState>): void {
  Object.assign(state, options);
  palette = pc.createColors(state.color);
}

export const isJson = (): boolean => state.json;
export const isInteractive = (): boolean =>
  !state.json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY) && !process.env.CI;
export const isTTY = (): boolean => Boolean(process.stdout.isTTY);

/** Colour helpers bound to the current palette (so `--no-color` is honoured). */
export const c = {
  bold: (s: string) => palette.bold(s),
  dim: (s: string) => palette.dim(s),
  italic: (s: string) => palette.italic(s),
  underline: (s: string) => palette.underline(s),
  red: (s: string) => palette.red(s),
  green: (s: string) => palette.green(s),
  yellow: (s: string) => palette.yellow(s),
  blue: (s: string) => palette.blue(s),
  magenta: (s: string) => palette.magenta(s),
  cyan: (s: string) => palette.cyan(s),
  gray: (s: string) => palette.gray(s),
  white: (s: string) => palette.white(s),
  bgRed: (s: string) => palette.bgRed(s),
  inverse: (s: string) => palette.inverse(s),
  /** Brand accent. */
  accent: (s: string) => palette.yellow(s),
};

export const sym = {
  ok: '✔',
  fail: '✖',
  warn: '▲',
  info: 'ℹ',
  dot: '●',
  ring: '○',
  arrow: '→',
  bullet: '·',
  bar: '│',
  star: '★',
};

// ---- writing ---------------------------------------------------------------

export function out(line = ''): void {
  if (state.json) return;
  process.stdout.write(line + '\n');
}

export function err(line = ''): void {
  process.stderr.write(line + '\n');
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** In JSON mode print the document; otherwise run the human printer. */
export function emit(value: unknown, human: () => void): void {
  if (state.json) {
    printJson(value);
    return;
  }
  human();
}

export const log = {
  info: (message: string): void => {
    if (state.json || state.quiet) return;
    out(`${c.blue(sym.info)} ${message}`);
  },
  success: (message: string): void => {
    if (state.json || state.quiet) return;
    out(`${c.green(sym.ok)} ${message}`);
  },
  warn: (message: string): void => {
    if (state.json) return;
    err(`${c.yellow(sym.warn)} ${message}`);
  },
  error: (message: string, hint?: string): void => {
    err(`${c.red(sym.fail)} ${message}`);
    if (hint) err(`  ${c.dim(hint)}`);
  },
  step: (message: string): void => {
    if (state.json || state.quiet) return;
    out(`${c.dim(sym.bar)} ${message}`);
  },
  blank: (): void => out(),
};

// ---- formatting ------------------------------------------------------------

/** Colour and glyph for a resource status, shared by every table and view. */
export function statusBadge(status: string | null | undefined): string {
  const value = (status || 'unknown').toLowerCase();
  switch (value) {
    case 'deployed':
    case 'ready':
    case 'healthy':
    case 'active':
    case 'completed':
    case 'success':
      return c.green(`${sym.dot} ${value}`);
    case 'deploying':
    case 'building':
    case 'provisioning':
    case 'queued':
    case 'pending':
    case 'in_progress':
    case 'pending_verification':
      return c.yellow(`${sym.ring} ${value}`);
    case 'failed':
    case 'delete_failed':
    case 'error':
    case 'degraded':
      return c.red(`${sym.fail} ${value}`);
    case 'deleting':
    case 'deleted':
      return c.gray(`${sym.ring} ${value}`);
    default:
      return c.gray(`${sym.ring} ${value}`);
  }
}

export function severityBadge(severity: string): string {
  const s = (severity || 'DEFAULT').toUpperCase().padEnd(8);
  switch (severity?.toUpperCase()) {
    case 'ERROR':
    case 'CRITICAL':
    case 'ALERT':
    case 'EMERGENCY':
      return c.red(s);
    case 'WARNING':
      return c.yellow(s);
    case 'INFO':
    case 'NOTICE':
      return c.blue(s);
    case 'DEBUG':
      return c.gray(s);
    default:
      return c.dim(s);
  }
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return c.dim('never');
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return c.dim('unknown');
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? 'ago' : 'from now';
  if (abs < 45) return 'just now';
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`;
  if (abs < 86400 * 30) return `${Math.round(abs / 86400)}d ${suffix}`;
  return date.toISOString().slice(0, 10);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '';
  return id.length > length ? id.slice(0, length) : id;
}

export function truncate(value: string, width: number): string {
  if (visibleLength(value) <= width) return value;
  if (width <= 1) return '…';
  let result = '';
  let used = 0;
  for (const char of stripAnsi(value)) {
    if (used + 1 > width - 1) break;
    result += char;
    used += 1;
  }
  return result + '…';
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function visibleLength(value: string): number {
  return [...stripAnsi(value)].length;
}

function pad(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - visibleLength(value));
  return align === 'right' ? ' '.repeat(gap) + value : value + ' '.repeat(gap);
}

export interface Column<T> {
  header: string;
  /** Cell text, may contain colour codes. */
  cell: (row: T) => string;
  align?: 'left' | 'right';
  /** Cap on visible width; longer cells are truncated with an ellipsis. */
  maxWidth?: number;
}

/**
 * Render rows as an aligned table. Headers are dim uppercase; no borders,
 * because borders survive badly in narrow terminals and copy-paste.
 */
export function renderTable<T>(rows: T[], columns: Column<T>[], options: { indent?: string } = {}): string {
  const indent = options.indent ?? '  ';
  const terminalWidth = process.stdout.columns || 120;

  const cells = rows.map((row) =>
    columns.map((column) => {
      const value = column.cell(row) ?? '';
      const width = column.maxWidth ?? Math.max(20, Math.floor(terminalWidth / 2));
      return truncate(value, width);
    })
  );

  const widths = columns.map((column, index) =>
    Math.max(visibleLength(column.header), ...cells.map((cell) => visibleLength(cell[index] ?? '')))
  );

  const lines: string[] = [];
  lines.push(
    indent + columns.map((column, index) => c.dim(pad(column.header.toUpperCase(), widths[index] ?? 0, column.align))).join('  ')
  );
  for (const row of cells) {
    lines.push(indent + row.map((cell, index) => pad(cell, widths[index] ?? 0, columns[index]?.align)).join('  '));
  }
  return lines.join('\n');
}

export function printTable<T>(rows: T[], columns: Column<T>[], options?: { indent?: string }): void {
  out(renderTable(rows, columns, options));
}

/** Aligned label/value pairs for a detail view. */
export function renderDetails(pairs: Array<[string, string | null | undefined]>, options: { indent?: string } = {}): string {
  const indent = options.indent ?? '  ';
  const visible = pairs.filter(([, value]) => value !== undefined && value !== null && value !== '');
  const width = Math.max(...visible.map(([label]) => label.length), 0);
  return visible.map(([label, value]) => `${indent}${c.dim(label.padEnd(width))}  ${value}`).join('\n');
}

export function printDetails(pairs: Array<[string, string | null | undefined]>, options?: { indent?: string }): void {
  out(renderDetails(pairs, options));
}

export function heading(text: string): void {
  out(c.bold(text));
}

export function link(url: string): string {
  return c.cyan(c.underline(url));
}

export function maskSecret(value: string): string {
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}${'•'.repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

/** Small "☁ Light Cloud" wordmark for intros. */
export function brand(): string {
  return `${c.accent('☁')} ${c.bold('Light Cloud')}`;
}
