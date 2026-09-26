import * as path from 'node:path';
import type { Command } from 'commander';
import { detectLocalProject } from '../lib/detection/detect.js';
import { detectGit } from '../lib/detection/git.js';
import { CliError, EXIT } from '../lib/errors.js';
import { brand, c, emit, isJson, link, log, out, sym } from '../lib/ui/output.js';
import { intro, outro } from '../lib/ui/prompts.js';
import { contextFrom, describeDetection, runDeploy, sourceLabel, uploadSource, warnIfDirty } from './shared.js';

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy [app]')
    .description('Deploy an app (the linked app by default) and follow the build')
    .option('-e, --env <env>', 'environment to deploy (default: production)')
    .option('-u, --upload', 'upload the local folder as the source instead of pulling from git')
    .option('-d, --dir <path>', 'folder to upload (with --upload)', '.')
    .option('--no-watch', 'queue the deployment and return immediately')
    .action(async (positional: string | undefined, options: { env?: string; upload?: boolean; dir: string; watch: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional);
      const env = await ctx.resolveEnv(app, options.env);
      const isUploadApp = app.git_provider === 'upload' || app.github_repo_url?.startsWith('upload://');

      intro(`${brand()} deploy`);
      if (!isJson()) {
        out(`${c.dim('│')}  ${c.bold(app.name)} ${c.dim(sym.arrow)} ${env.name}${env.is_production ? c.accent(` ${sym.star}`) : ''}`);
      }

      let uploadId: string | undefined;
      // An upload-sourced app has nothing to pull. Run from the folder it is
      // linked to, `lc deploy` sends that folder again — what "deploy" means
      // after editing files. Elsewhere it re-uses the last archive unless
      // --upload names one.
      const linkedHere = isUploadApp && ctx.project?.config.applicationId === app.id;
      if (options.upload || linkedHere) {
        uploadId = await uploadForDeploy(ctx, options.dir);
      } else if (isUploadApp) {
        if (!isJson()) out(`${c.dim('│')}  Source: last upload ${c.dim('(pass --upload to send this folder)')}`);
      } else if (!isJson()) {
        out(`${c.dim('│')}  Source: ${sourceLabel(app)} ${c.dim(`@ ${env.github_branch}`)}`);
      }
      if (!isJson()) out(c.dim('│'));

      const result = await runDeploy(ctx, { app, env, uploadId, watch: options.watch });
      const url = result.watched?.update.deployed_url || env.deployed_url;

      emit(
        {
          ok: true,
          application: { id: app.id, name: app.name },
          environment: { id: env.id, name: env.name },
          uploadId,
          status: result.watched?.status ?? 'queued',
          url,
          durationMs: result.watched?.elapsedMs,
        },
        () => {
          if (!options.watch) {
            outro(`Queued. Follow it with ${c.bold(`lc status ${app.name}`)} or ${c.bold('lc logs -f')}.`);
          } else {
            outro(url ? `Live at ${link(url)}` : 'Done.');
          }
        }
      );
    });
}

async function uploadForDeploy(ctx: ReturnType<typeof contextFrom>, dir: string): Promise<string> {
  const directory = path.resolve(dir);
  const detection = detectLocalProject(directory);
  const git = detectGit(directory);
  if (!isJson()) out(`${c.dim('│')}  Source: upload ${c.dim(directory)}  ${describeDetection(detection)}`);
  warnIfDirty(git.isDirty, git.branch);
  if (!detection.framework && !detection.hasDockerfile) {
    throw new CliError(`Could not tell what kind of project ${directory} is.`, {
      hint: 'Run from the project root (where package.json, requirements.txt, go.mod or a Dockerfile lives).',
      exitCode: EXIT.USAGE,
    });
  }
  const upload = await uploadSource(ctx, directory, detection);
  return upload.uploadId;
}
