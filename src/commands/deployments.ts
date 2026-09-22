import type { Command } from 'commander';
import type { Deployment } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { StepRenderer, watchResource } from '../lib/realtime/watch.js';
import { c, emit, formatDuration, heading, isJson, link, log, out, printDetails, relativeTime, shortId, statusBadge, sym } from '../lib/ui/output.js';
import { confirm, select } from '../lib/ui/prompts.js';
import { contextFrom, printDeploymentsTable } from './shared.js';

export function registerDeploymentCommands(program: Command): void {
  program
    .command('deployments [app]')
    .alias('history')
    .description('Deployment history of an environment')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('-n, --limit <n>', 'how many to show (max 20)', '10')
    .action(async (positional: string | undefined, options: { env?: string; limit: string }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const page = await ctx.api.listDeployments(org.id, env.id, Math.min(20, Math.max(1, Number(options.limit) || 10)));
      emit(page, () => {
        heading(`${app.name} / ${env.name} ${c.dim(`· ${page.total} deployment${page.total === 1 ? '' : 's'}`)}`);
        out();
        if (page.deployments.length === 0) {
          log.info('No deployments yet.');
          return;
        }
        printDeploymentsTable(page.deployments);
        out();
        out(c.dim(`  lc deployment <id> for the build log · lc rollback to go back`));
      });
    });

  program
    .command('deployment <id>')
    .description('Show one deployment with its build log')
    .action(async (id: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const deployment = await ctx.api.getDeployment(org.id, id);
      emit(deployment, () => printDeployment(deployment));
    });

  program
    .command('rollback [deployment]')
    .description('Roll an environment back to an earlier deployment (no rebuild)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--no-watch', 'do not wait for the rollback to finish')
    .action(async (ref: string | undefined, options: { app?: string; env?: string; watch: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const page = await ctx.api.listDeployments(org.id, env.id, 20);
      const eligible = page.deployments.filter((d) => d.rollback_eligible && !d.is_current);

      let target: Deployment | undefined;
      if (ref) {
        target = page.deployments.find((d) => d.id === ref || d.id.startsWith(ref));
        if (!target) throw new CliError(`No deployment "${ref}" on ${app.name} / ${env.name}.`, { hint: 'Run `lc deployments` to list them.', exitCode: EXIT.NOT_FOUND });
        if (!target.rollback_eligible) throw new CliError(`Deployment ${shortId(target.id, 10)} cannot be rolled back to.`, { hint: 'Only successful deployments within the rollback window are eligible.', exitCode: EXIT.USAGE });
        if (target.is_current) throw new CliError('That deployment is already live.', { exitCode: EXIT.USAGE });
      } else {
        if (eligible.length === 0) throw new CliError(`Nothing to roll back to on ${app.name} / ${env.name}.`, { exitCode: EXIT.NOT_FOUND });
        const id = await select<string>(
          'Roll back to',
          eligible.map((d) => ({
            value: d.id,
            label: `${d.commit_sha ? d.commit_sha.slice(0, 7) : shortId(d.id, 10)}  ${d.commit_message?.split('\n')[0] ?? ''}`.trim(),
            hint: `${relativeTime(d.started_at)} · ${d.deployed_by_name}`,
          })),
          { flag: '<deployment id>' }
        );
        target = eligible.find((d) => d.id === id)!;
      }

      const ok = await confirm(
        `Roll ${c.bold(`${app.name} / ${env.name}`)} back to ${c.accent(target.commit_sha?.slice(0, 7) ?? shortId(target.id, 10))} ${c.dim(`(${relativeTime(target.started_at)})`)}?`,
        { yes: ctx.yes, initialValue: true }
      );
      if (!ok) return;

      const result = await ctx.api.rollback(org.id, env.id, target.id);
      if (!isJson()) out(`${c.green(sym.ok)} Rollback queued ${c.dim(shortId(result.deployment?.id, 10))}`);

      let final = result;
      if (options.watch) {
        const watched = await watchResource(ctx.api, { kind: 'environment', id: env.id, organisationId: org.id });
        if (!watched.ok) {
          throw new CliError(watched.update.deployment_error || 'Rollback failed.', { exitCode: EXIT.FAILED });
        }
        final = { deployment: { ...result.deployment, status: watched.status, deployed_url: watched.update.deployed_url } };
      }
      emit({ ok: true, ...final }, () => undefined);
    });
}

export function printDeployment(deployment: Deployment): void {
  heading(`Deployment ${shortId(deployment.id, 10)}  ${statusBadge(deployment.status)}`);
  printDetails([
    ['App', deployment.application_name ? `${deployment.application_name} / ${deployment.environment_name ?? ''}` : undefined],
    ['Commit', deployment.commit_sha ? `${c.accent(deployment.commit_sha.slice(0, 7))} ${deployment.commit_message?.split('\n')[0] ?? ''}${deployment.commit_author ? c.dim(`  ${deployment.commit_author}`) : ''}` : undefined],
    ['By', deployment.deployed_by_name],
    ['Started', `${relativeTime(deployment.started_at)} ${c.dim(deployment.started_at)}`],
    ['Duration', deployment.duration_seconds != null ? formatDuration(deployment.duration_seconds * 1000) : undefined],
    ['URL', deployment.deployed_url ? link(deployment.deployed_url) : undefined],
    ['Rollback', deployment.is_current ? 'current' : deployment.rollback_eligible ? 'eligible' : 'not eligible'],
    ['Error', deployment.deployment_error ? c.red(deployment.deployment_error) : undefined],
  ]);
  if (deployment.deployment_logs?.length) {
    out();
    const renderer = new StepRenderer(false);
    renderer.render(deployment.deployment_logs);
  }
}
