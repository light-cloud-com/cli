/**
 * Pieces several commands share: tables, labels, the deploy-and-watch loop
 * and the upload pipeline.
 */

import type { Command } from 'commander';
import type { Application, Database, Deployment, Environment, UploadComplete } from '../lib/api/types.js';
import { Context, type GlobalOptions } from '../lib/context.js';
import type { LocalDetection } from '../lib/detection/detect.js';
import { CliError, EXIT } from '../lib/errors.js';
import { watchResource, type WatchResult } from '../lib/realtime/watch.js';
import { packageSource } from '../lib/upload/packager.js';
import { describeStorageUploadFailure } from '../lib/upload/storage-error.js';
import {
  c,
  formatBytes,
  formatDuration,
  isJson,
  link,
  log,
  out,
  printTable,
  relativeTime,
  shortId,
  statusBadge,
  sym,
} from '../lib/ui/output.js';
import { spinner } from '../lib/ui/prompts.js';

export function contextFrom(command: Command): Context {
  const options = command.optsWithGlobals() as GlobalOptions;
  return new Context(options);
}

// ---- labels ------------------------------------------------------------------

export function sourceLabel(app: Application): string {
  if (app.git_provider === 'upload' || app.github_repo_url?.startsWith('upload://')) return 'upload';
  const host = app.git_provider === 'gitlab' ? 'gitlab.com' : app.git_provider === 'bitbucket' ? 'bitbucket.org' : 'github.com';
  if (app.github_repo_owner && app.github_repo_name) return `${host}/${app.github_repo_owner}/${app.github_repo_name}`;
  return app.github_repo_url || app.git_provider || 'unknown';
}

export function appUrl(app: Application, env?: Environment | null): string | undefined {
  return env?.deployed_url || app.deployed_url || app.environments?.find((e) => e.is_production)?.deployed_url || undefined;
}

export function envName(env: Environment): string {
  return env.is_production ? `${env.name} ${c.accent(sym.star)}` : env.name;
}

// ---- tables ------------------------------------------------------------------

export function printAppsTable(apps: Application[]): void {
  printTable(apps, [
    { header: 'App', cell: (app) => c.bold(app.name) },
    { header: 'Status', cell: (app) => statusBadge(app.status) },
    { header: 'Type', cell: (app) => `${app.deployment_type} ${c.dim(sym.bullet)} ${app.framework}` },
    { header: 'Envs', cell: (app) => String(app.environments?.length ?? 0), align: 'right' },
    { header: 'URL', cell: (app) => (appUrl(app) ? link(appUrl(app)!) : c.dim('—')), maxWidth: 60 },
    { header: 'Updated', cell: (app) => c.dim(relativeTime(app.updated_at)) },
  ]);
}

export function printEnvsTable(envs: Environment[]): void {
  printTable(envs, [
    { header: 'Environment', cell: envName },
    { header: 'Status', cell: (env) => statusBadge(env.status) },
    { header: 'Branch', cell: (env) => env.github_branch || c.dim('—') },
    { header: 'URL', cell: (env) => (env.deployed_url ? link(env.deployed_url) : c.dim('—')), maxWidth: 60 },
    { header: 'Domain', cell: (env) => (env.custom_domain ? `${env.custom_domain} ${c.dim(env.custom_domain_status ?? '')}` : c.dim('—')) },
    { header: 'Deployed', cell: (env) => c.dim(relativeTime(env.last_deployed_at)) },
  ]);
}

export function printDeploymentsTable(deployments: Deployment[]): void {
  printTable(deployments, [
    { header: 'ID', cell: (d) => c.dim(shortId(d.id, 10)) },
    { header: 'Status', cell: (d) => statusBadge(d.status) },
    { header: 'Commit', cell: (d) => (d.commit_sha ? `${c.accent(d.commit_sha.slice(0, 7))} ${d.commit_message?.split('\n')[0] ?? ''}` : c.dim('—')), maxWidth: 56 },
    { header: 'By', cell: (d) => d.deployed_by_name || c.dim('—') },
    { header: 'Took', cell: (d) => (d.duration_seconds != null ? formatDuration(d.duration_seconds * 1000) : c.dim('—')), align: 'right' },
    { header: 'Started', cell: (d) => c.dim(relativeTime(d.started_at)) },
    { header: '', cell: (d) => (d.is_current ? c.green('current') : d.rollback_eligible ? c.dim('rollback ok') : '') },
  ]);
}

export function printDbsTable(dbs: Database[]): void {
  printTable(dbs, [
    { header: 'Database', cell: (db) => c.bold(db.name) },
    { header: 'Status', cell: (db) => statusBadge(db.status) },
    { header: 'Engine', cell: (db) => db.database_type },
    { header: 'Tier', cell: (db) => db.tier },
    { header: 'Region', cell: (db) => db.region },
    { header: 'Host', cell: (db) => db.connection_hostname || db.connection_host || c.dim('—') },
    { header: 'Created', cell: (db) => c.dim(relativeTime(db.created_at)) },
  ]);
}

// ---- deploy --------------------------------------------------------------------

export interface DeployRunOptions {
  app: Application;
  env?: Environment | null;
  uploadId?: string;
  watch: boolean;
}

export interface DeployRunResult {
  queued: Environment | Application;
  watched?: WatchResult;
}

export async function runDeploy(ctx: Context, options: DeployRunOptions): Promise<DeployRunResult> {
  const org = await ctx.resolveOrg();
  const { app, env } = options;

  const queued = env
    ? await ctx.api.deployEnvironment(org.id, env.id, options.uploadId)
    : await ctx.api.deployApplication(org.id, app.id, options.uploadId);

  if (!isJson()) {
    out(`${c.green(sym.ok)} Deployment queued ${c.dim(`${app.name}${env ? ` / ${env.name}` : ''}`)}`);
  }
  if (!options.watch) return { queued };

  const watched = await watchResource(ctx.api, {
    kind: env ? 'environment' : 'application',
    id: env ? env.id : app.id,
    organisationId: org.id,
  });

  if (!watched.ok) {
    throw new CliError(watched.update.deployment_error || `Deployment ended with status "${watched.status}".`, {
      hint: `See the full log with \`lc deployments${env ? ` --env ${env.name}` : ''}\` or in the console: ${ctx.appConsoleUrl(app)}`,
      exitCode: EXIT.FAILED,
      code: 'DEPLOY_FAILED',
    });
  }
  return { queued, watched };
}

// ---- upload --------------------------------------------------------------------

export interface UploadOutcome {
  uploadId: string;
  fileCount: number;
  totalSize: number;
  archiveSize: number;
  /** The backend's own reading of the archive — the console's detector, so it beats local guesses. */
  server: UploadComplete;
}

export async function uploadSource(ctx: Context, directory: string, detection: LocalDetection): Promise<UploadOutcome> {
  const org = await ctx.resolveOrg();
  const spin = spinner();
  spin.start('Packaging source');
  const pack = await packageSource({
    directory,
    onProgress: (files) => {
      if (files % 250 === 0) spin.message(`Packaging source ${c.dim(`${files} files`)}`);
    },
  });
  spin.message(`Packaged ${pack.fileCount} files ${c.dim(`(${formatBytes(pack.totalSize)} → ${formatBytes(pack.buffer.length)})`)}`);

  if (pack.fileCount === 0) {
    spin.stop('Nothing to upload', 1);
    throw new CliError(`No files to upload in ${directory}.`, {
      hint: 'Everything matched an ignore rule. Check .gitignore and run from the project root.',
      exitCode: EXIT.USAGE,
    });
  }

  const session = await ctx.api.requestUpload(org.id, pack.buffer.length);
  if (pack.buffer.length > session.maxSize) {
    spin.stop('Archive too large', 1);
    throw new CliError(`The source archive is ${formatBytes(pack.buffer.length)}; the limit is ${formatBytes(session.maxSize)}.`, {
      hint: 'Exclude build output and large assets via .gitignore, or deploy from a git repository instead.',
      exitCode: EXIT.USAGE,
    });
  }

  spin.message(`Uploading ${formatBytes(pack.buffer.length)}`);
  const put = await fetch(session.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: new Uint8Array(pack.buffer),
  });
  if (!put.ok) {
    spin.stop('Upload failed', 1);
    throw new CliError(`Upload failed: ${describeStorageUploadFailure(put)}`, {
      hint: put.status === 403 ? 'Deploy from a git repository meanwhile: lc deploy --repo <owner/name>.' : 'Try again in a moment.',
    });
  }

  spin.message('Inspecting source');
  const server = await ctx.api.completeUpload(org.id, session.uploadId, {
    detectedFramework: detection.framework,
    detectedRuntime: detection.runtime,
    detectedDeploymentType: detection.deploymentType,
    detectedBuildCommand: detection.buildCommand,
    detectedOutputDirectory: detection.outputDirectory,
  });
  spin.stop(`Uploaded ${pack.fileCount} files ${c.dim(`(${formatBytes(pack.buffer.length)})`)}`);
  if (server.detectionSource === 'server' && server.detectedFramework && server.detectedFramework !== detection.framework) {
    log.info(`Light Cloud read the source as ${server.detectedFramework} (${server.detectedDeploymentType}).`);
  }
  if (server.configWarning) log.warn(server.configWarning);

  return { uploadId: session.uploadId, fileCount: pack.fileCount, totalSize: pack.totalSize, archiveSize: pack.buffer.length, server };
}

export function describeDetection(detection: LocalDetection): string {
  const parts: string[] = [];
  parts.push(detection.frameworkLabel ? c.bold(detection.frameworkLabel) : c.yellow('unknown framework'));
  parts.push(detection.deploymentType === 'static' ? 'static site' : 'container');
  if (detection.packageManager) parts.push(detection.packageManager);
  if (detection.notes.length) parts.push(c.dim(detection.notes.join(', ')));
  return parts.join(` ${c.dim(sym.bullet)} `);
}

export function warnIfDirty(isDirty: boolean | undefined, branch: string | undefined): void {
  if (isDirty) log.warn(`Uncommitted changes on ${c.bold(branch ?? 'this branch')} will be included in the upload.`);
}
