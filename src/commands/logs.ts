import type { Command } from 'commander';
import type { LogEntry, LogSeverity } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { readSse } from '../lib/realtime/log-stream.js';
import { c, isJson, log, out, printJson, severityBadge } from '../lib/ui/output.js';
import { contextFrom } from './shared.js';

const SEVERITIES: LogSeverity[] = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'];

export function registerLogsCommand(program: Command): void {
  program
    .command('logs [app]')
    .description('Show runtime logs of an environment; -f to follow')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('-f, --follow', 'keep streaming new log lines')
    .option('-n, --lines <n>', 'how many recent lines to show first', '100')
    .option('--since <duration>', 'how far back to look, e.g. 30m, 2h, 1d', '1h')
    .option('-s, --severity <levels>', 'comma-separated: ERROR,WARNING,INFO,DEBUG …')
    .option('--min-severity <level>', 'this level and above, e.g. WARNING')
    .option('--search <text>', 'only lines containing this text')
    .option('--no-timestamps', 'hide timestamps')
    .action(async (positional: string | undefined, options: LogsOptions, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();

      if (app.deployment_type === 'static' || !env.cloud_run_service) {
        throw new CliError(`${app.name} / ${env.name} is a static site; it has no runtime logs.`, {
          hint: 'Deployment logs are under `lc deployments`.',
          exitCode: EXIT.USAGE,
        });
      }

      const severity = parseSeverity(options);
      const lines = Math.max(1, Math.min(1000, Number(options.lines) || 100));
      const since = new Date(Date.now() - parseDuration(options.since)).toISOString();

      const page = await ctx.api.fetchLogs(org.id, env.id, {
        startTime: since,
        severity,
        textSearch: options.search,
        pageSize: lines,
      });
      const entries = [...(page.logs ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-lines);

      if (isJson() && !options.follow) {
        printJson(entries);
        return;
      }

      if (entries.length === 0 && !options.follow) {
        log.info(`No logs on ${app.name} / ${env.name} in the last ${options.since}${severity ? ` at ${severity.join(',')}` : ''}.`);
        return;
      }
      for (const entry of entries) printEntry(entry, options.timestamps);

      if (!options.follow) return;

      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      if (!isJson()) out(c.dim(`── following ${app.name} / ${env.name} · ctrl-c to stop ──`));
      const seen = new Set(entries.map((entry) => entry.insertId));
      const search = options.search?.toLowerCase();

      try {
        const response = await ctx.api.streamLogs(org.id, env.id, severity, controller.signal);
        for await (const update of readSse(response, controller.signal)) {
          if (update.type === 'error') {
            log.warn(update.error ?? 'stream error');
            continue;
          }
          if (update.type !== 'log' || !update.entry) continue;
          if (seen.has(update.entry.insertId)) continue;
          seen.add(update.entry.insertId);
          if (search && !entryText(update.entry).toLowerCase().includes(search)) continue;
          if (isJson()) printJson(update.entry);
          else printEntry(update.entry, options.timestamps);
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    });
}

interface LogsOptions {
  env?: string;
  follow?: boolean;
  lines: string;
  since: string;
  severity?: string;
  minSeverity?: string;
  search?: string;
  timestamps: boolean;
}

function parseSeverity(options: LogsOptions): LogSeverity[] | undefined {
  if (options.severity) {
    const levels = options.severity.split(',').map((level) => level.trim().toUpperCase()) as LogSeverity[];
    const bad = levels.filter((level) => !SEVERITIES.includes(level));
    if (bad.length) throw new CliError(`Unknown severity: ${bad.join(', ')}.`, { hint: `Use: ${SEVERITIES.join(', ')}.`, exitCode: EXIT.USAGE });
    return levels;
  }
  if (options.minSeverity) {
    const level = options.minSeverity.trim().toUpperCase() as LogSeverity;
    const index = SEVERITIES.indexOf(level);
    if (index === -1) throw new CliError(`Unknown severity "${options.minSeverity}".`, { hint: `Use: ${SEVERITIES.join(', ')}.`, exitCode: EXIT.USAGE });
    return SEVERITIES.slice(index);
  }
  return undefined;
}

export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+)\s*(s|m|h|d|w)?$/i);
  if (!match) throw new CliError(`"${value}" is not a duration.`, { hint: 'Examples: 90s, 30m, 2h, 1d.', exitCode: EXIT.USAGE });
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 604_800_000;
  return amount * factor;
}

function entryText(entry: LogEntry): string {
  if (entry.textPayload) return entry.textPayload;
  if (entry.httpRequest) return `${entry.httpRequest.requestMethod} ${entry.httpRequest.requestUrl}`;
  if (entry.jsonPayload) {
    const payload = entry.jsonPayload as Record<string, unknown>;
    const message = payload.message ?? payload.msg ?? payload.error;
    return typeof message === 'string' ? message : JSON.stringify(payload);
  }
  return '';
}

export function formatEntry(entry: LogEntry, withTimestamp = true): string {
  const time = withTimestamp ? c.dim(formatTime(entry.timestamp)) + '  ' : '';
  const badge = severityBadge(entry.severity);
  if (entry.httpRequest) {
    const { requestMethod, requestUrl, status, latency } = entry.httpRequest;
    let pathname = requestUrl;
    try {
      const parsed = new URL(requestUrl);
      pathname = parsed.pathname + parsed.search;
    } catch {
      // keep as-is
    }
    const code = status >= 500 ? c.red(String(status)) : status >= 400 ? c.yellow(String(status)) : c.green(String(status));
    const ms = latency ? c.dim(latency.replace(/^([\d.]+)s$/, (_, s) => `${Math.round(Number(s) * 1000)}ms`)) : '';
    const text = entry.textPayload ? `  ${entry.textPayload}` : '';
    return `${time}${badge} ${c.bold(requestMethod.padEnd(6))} ${pathname} ${code} ${ms}${text}`;
  }
  const text = entryText(entry);
  return `${time}${badge} ${text.replace(/\s+$/, '')}`;
}

function printEntry(entry: LogEntry, withTimestamp: boolean): void {
  out(formatEntry(entry, withTimestamp));
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
