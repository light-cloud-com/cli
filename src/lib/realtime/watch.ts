/**
 * Follow a deployment or provisioning run to its end.
 *
 * Updates arrive over Socket.IO and, as a safety net, from polling the status
 * endpoint every few seconds — an event lost during a reconnect must not leave
 * the terminal hanging. Each update carries the full step list, so rendering
 * is a diff against what has already been printed.
 */

import type { LightCloudApi } from '../api/light-cloud.js';
import type { DeploymentLogStep, ResourceUpdate } from '../api/types.js';
import { CliError, EXIT } from '../errors.js';
import { c, formatDuration, isJson, out, sym } from '../ui/output.js';
import { spinner, type Spinner } from '../ui/prompts.js';
import { connectLive, type ResourceKind } from './socket.js';
import { resolveAuth } from '../auth/credentials.js';

export interface WatchTarget {
  kind: Exclude<ResourceKind, 'organisation'>;
  id: string;
  organisationId: string;
}

export interface WatchOptions {
  /** Give up after this long; the run continues server-side. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Print nothing; just resolve with the final state. */
  silent?: boolean;
  /** Steps already shown (e.g. from a previous attempt) are skipped. */
  startedAt?: number;
}

export interface WatchResult {
  status: string;
  update: ResourceUpdate;
  ok: boolean;
  elapsedMs: number;
}

const TERMINAL: Record<WatchTarget['kind'], Set<string>> = {
  environment: new Set(['deployed', 'failed', 'delete_failed', 'deleted']),
  application: new Set(['deployed', 'failed', 'delete_failed', 'deleted', 'healthy', 'degraded']),
  database: new Set(['ready', 'failed', 'delete_failed', 'deleted']),
};

const SUCCESS = new Set(['deployed', 'ready', 'healthy', 'deleted']);

/**
 * Print steps as they change. Shared by deploy, database create and rollback.
 *
 * The backend appends a new log entry when a step completes instead of
 * updating the one that started it, so steps are matched by name, not by
 * position. A step that completes while another is still running is held back
 * until the running one stops, so it never lands inside the spinner's line.
 */
export class StepRenderer {
  private printed = new Map<string, DeploymentLogStep['status']>();
  private startedAt = new Map<string, number>();
  private spin: Spinner | null = null;
  private active: string | null = null;
  private held: string[] = [];
  private seen = 0;

  constructor(private readonly silent: boolean) {}

  render(steps: DeploymentLogStep[] | null | undefined): void {
    if (this.silent || isJson() || !steps) return;
    // Entries only ever get appended; each update carries the whole list. A
    // shorter list is a new run.
    if (steps.length < this.seen) {
      this.seen = 0;
      this.printed.clear();
    }
    for (const step of steps.slice(this.seen)) this.renderStep(step);
    this.seen = Math.max(this.seen, steps.length);
  }

  private renderStep(step: DeploymentLogStep): void {
    const name = stepLabel(step.step);
    if (this.printed.get(name) === step.status) return;
    this.printed.set(name, step.status);

    if (step.status === 'started') {
      this.startedAt.set(name, Date.parse(step.timestamp) || Date.now());
      this.stopSpinner();
      this.spin = spinner();
      this.spin.start(name);
      this.active = name;
      return;
    }

    const began = this.startedAt.get(name);
    const finished = Date.parse(step.timestamp) || Date.now();
    const took = began ? c.dim(`  ${formatDuration(finished - began)}`) : '';
    const ok = step.status === 'completed';
    const line = ok ? `${name}${took}` : `${name}${step.message ? c.red(`  ${step.message}`) : ''}`;
    if (this.active === name && this.spin) {
      this.spin.stop(line, ok ? 0 : 1);
      this.spin = null;
      this.active = null;
      this.flush();
    } else if (this.spin) {
      this.held.push(`${ok ? c.green(sym.ok) : c.red(sym.fail)} ${line}`);
    } else {
      out(`${ok ? c.green(sym.ok) : c.red(sym.fail)} ${line}`);
    }
  }

  finish(message: string, ok: boolean): void {
    if (this.silent || isJson()) return;
    if (this.spin) {
      this.spin.stop(message, ok ? 0 : 1);
      this.spin = null;
      this.active = null;
      this.flush();
    } else {
      this.flush();
      out(`${ok ? c.green(sym.ok) : c.red(sym.fail)} ${message}`);
    }
  }

  private flush(): void {
    for (const line of this.held) out(line);
    this.held = [];
  }

  private stopSpinner(): void {
    if (this.spin && this.active !== null) {
      // The previous step never reported completion; show it as done rather
      // than leaving a spinner on screen forever.
      this.spin.stop(this.active, 0);
      this.spin = null;
      this.active = null;
      this.flush();
    }
  }
}

// Step names come from the deployer and name the storage it writes to
// ("Uploading files to R2"); users only need to know what is happening.
function stepLabel(step: string): string {
  return step.replace(/ to R2\b/, '').replace(/\bR2 /, '').trim();
}

async function fetchStatus(api: LightCloudApi, target: WatchTarget): Promise<ResourceUpdate> {
  switch (target.kind) {
    case 'environment':
      return api.environmentStatus(target.organisationId, target.id);
    case 'application':
      return api.applicationStatus(target.organisationId, target.id);
    case 'database':
      return api.databaseStatus(target.organisationId, target.id);
  }
}

export async function watchResource(api: LightCloudApi, target: WatchTarget, options: WatchOptions = {}): Promise<WatchResult> {
  const timeoutMs = options.timeoutMs ?? 25 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 4000;
  const startedAt = options.startedAt ?? Date.now();
  const renderer = new StepRenderer(Boolean(options.silent));
  const terminal = TERMINAL[target.kind];

  let lastSeenAt = 0;

  const live = await connectLive(api.client.endpoints.socketUrl, tokenForSocket());
  if (live) live.subscribe(target.kind, target.id);

  return new Promise<WatchResult>((resolve, reject) => {
    let finished = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let polling = false;

    const done = (update: ResourceUpdate) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      clearTimeout(deadline);
      live?.close();
      const ok = SUCCESS.has(update.status);
      resolve({ status: update.status, update, ok, elapsedMs: Date.now() - startedAt });
    };

    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      clearTimeout(deadline);
      live?.close();
      reject(error);
    };

    const apply = (update: ResourceUpdate) => {
      lastSeenAt = Date.now();
      renderer.render(update.deployment_logs);
      if (terminal.has(update.status)) done(update);
    };

    const deadline = setTimeout(() => {
      fail(
        new CliError(`Still running after ${formatDuration(timeoutMs)}; stopped waiting.`, {
          hint: 'The run continues on Light Cloud. Check it with `lc status` or in the console.',
          exitCode: EXIT.FAILED,
        })
      );
    }, timeoutMs);

    const eventName = `${target.kind}:update`;
    live?.onEvent<ResourceUpdate & { environmentId?: string; databaseId?: string; applicationId?: string }>(eventName, (data) => {
      const id = data.environmentId || data.databaseId || data.applicationId;
      if (id && id !== target.id) return;
      apply(data);
    });

    const poll = async (force = false) => {
      if (polling || finished) return;
      polling = true;
      try {
        // With a live socket, polling is only a safety net for lost events;
        // the first fetch always runs so a run that finished before the
        // socket joined its room is still seen.
        if (force || !live || Date.now() - lastSeenAt > pollIntervalMs * 2) {
          apply(await fetchStatus(api, target));
        }
      } catch (error) {
        // A transient poll failure is not the run failing; the next tick retries.
        if (error instanceof CliError && error.exitCode === EXIT.AUTH) fail(error);
      } finally {
        polling = false;
      }
    };

    void poll(true);
    pollTimer = setInterval(() => void poll(), pollIntervalMs);
  }).then((result) => {
    const took = formatDuration(result.elapsedMs);
    if (result.ok) {
      const url = result.update.deployed_url || result.update.connection_host;
      renderer.finish(`${verbFor(target.kind, true)} in ${took}${url ? `  ${c.cyan(url)}` : ''}`, true);
    } else {
      renderer.finish(`${verbFor(target.kind, false)} after ${took}${result.update.deployment_error ? `  ${c.red(result.update.deployment_error)}` : ''}`, false);
    }
    return result;
  });
}

function verbFor(kind: WatchTarget['kind'], ok: boolean): string {
  if (kind === 'database') return ok ? 'Database ready' : 'Provisioning failed';
  return ok ? 'Deployed' : 'Deployment failed';
}

function tokenForSocket(): string | null {
  return resolveAuth().token;
}
