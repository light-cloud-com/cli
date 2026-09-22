import type { Command } from 'commander';
import type { Application, Environment } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { openBrowser } from '../lib/open-browser.js';
import { c, emit, heading, isJson, link, log, out, printDetails, relativeTime, statusBadge, sym } from '../lib/ui/output.js';
import { confirm } from '../lib/ui/prompts.js';
import { appUrl, contextFrom, envName, printAppsTable, printEnvsTable, sourceLabel } from './shared.js';

export function registerAppCommands(program: Command): void {
  program
    .command('apps [filter]')
    .alias('ls')
    .alias('list')
    .description('List apps in the workspace')
    .action(async (filter: string | undefined, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const apps = await ctx.api.listApplications(org.id, filter);
      // Named in the empty state so a person on the wrong workspace sees the way out.
      const others = ctx.usingApiKey ? [] : ((await ctx.profile()).organisations ?? []).filter((o) => o.id !== org.id);
      emit(apps, () => {
        if (apps.length === 0) {
          log.info(filter ? `No apps matching "${filter}".` : `No apps in ${c.bold(org.name ?? 'this workspace')} yet. Run ${c.bold('lc init')} in a project folder to create one.`);
          if (!filter && others.length) {
            out(c.dim(`  Other workspaces: ${others.map((o) => o.name).join(', ')}  →  lc apps --org <name>, or lc org use <name> to switch.`));
          }
          return;
        }
        heading(`${org.name ?? 'Workspace'} ${c.dim(`· ${apps.length} app${apps.length === 1 ? '' : 's'}`)}`);
        out();
        printAppsTable(apps);
        const failing = apps.filter((app) => app.status === 'failed' || app.environments?.some((env) => env.status === 'failed'));
        if (failing.length) {
          out();
          log.warn(`${failing.length} app${failing.length === 1 ? '' : 's'} with a failed deployment: ${failing.map((app) => app.name).join(', ')}. Try ${c.bold('lc logs <app>')}.`);
        }
      });
    });

  program
    .command('status [app]')
    .description('Show an app with its environments and latest deployment')
    .option('-a, --app <app>', 'app name or id (alternative to the positional)')
    .action(async (positional: string | undefined, options: { app?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional ?? options.app);
      const org = await ctx.resolveOrg();
      const envs = app.environments ?? (await ctx.api.listEnvironments(org.id, app.id));
      emit({ ...app, environments: envs }, () => printAppStatus(ctx.appConsoleUrl(app), app, envs));
    });

  program
    .command('open [app]')
    .description('Open the deployed app (or the console page) in your browser')
    .option('-e, --env <env>', 'environment to open')
    .option('--console', 'open the app in the Light Cloud console instead')
    .action(async (positional: string | undefined, options: { env?: string; console?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional);
      let url: string | undefined;
      if (options.console) {
        url = ctx.appConsoleUrl(app);
      } else {
        const env = await ctx.resolveEnv(app, options.env);
        url = env.deployed_url || appUrl(app, env);
        if (!url) {
          throw new CliError(`${app.name} / ${env.name} has no URL yet.`, {
            hint: 'Deploy it first with `lc deploy`, or open the console with `lc open --console`.',
            exitCode: EXIT.NOT_FOUND,
          });
        }
      }
      const opened = openBrowser(url);
      emit({ url, opened }, () => (opened ? log.success(`Opened ${link(url!)}`) : out(url!)));
    });

  program
    .command('delete <app>')
    .alias('rm')
    .description('Delete an app and every environment in it')
    .action(async (ref: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(ref);
      const org = await ctx.resolveOrg();
      const envCount = app.environments?.length ?? 0;
      const ok = await confirm(
        `Delete ${c.bold(app.name)}${envCount ? ` and its ${envCount} environment${envCount === 1 ? '' : 's'}` : ''}? This cannot be undone.`,
        { yes: ctx.yes }
      );
      if (!ok) return;
      await ctx.api.deleteApplication(org.id, app.id);
      emit({ ok: true, id: app.id, name: app.name }, () => log.success(`Deleting ${c.bold(app.name)}. Resources are torn down in the background.`));
    });

  program
    .command('rename <app> <name>')
    .description('Rename an app')
    .action(async (ref: string, name: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(ref);
      const org = await ctx.resolveOrg();
      const updated = await ctx.api.renameApplication(org.id, app.id, name.trim());
      emit(updated, () => log.success(`${c.bold(app.name)} is now ${c.bold(updated.name ?? name)}.`));
    });
}

export function printAppStatus(consoleUrl: string, app: Application, envs: Environment[]): void {
  if (isJson()) return;
  const url = appUrl(app);
  heading(`${app.name}  ${statusBadge(app.status)}`);
  printDetails([
    ['Type', `${app.deployment_type} ${c.dim(sym.bullet)} ${app.framework}${app.runtime ? c.dim(` (${app.runtime})`) : ''}`],
    ['Source', `${sourceLabel(app)}${app.github_branch ? c.dim(`  ${app.github_branch}`) : ''}${app.root_directory ? c.dim(`  /${app.root_directory}`) : ''}`],
    ['URL', url ? link(url) : undefined],
    ['Domain', app.custom_domain ? `${app.custom_domain} ${c.dim(app.custom_domain_status ?? '')}` : undefined],
    ['Auto-deploy', app.auto_deploy_branches === undefined ? undefined : app.auto_deploy_branches ? 'on push' : 'off'],
    ['Last deploy', relativeTime(app.last_deployed_at)],
    ['Console', c.dim(consoleUrl)],
    ['ID', c.dim(app.id)],
  ]);

  if (app.status === 'failed' && app.deployment_error) {
    out();
    out(`  ${c.red(sym.fail)} ${app.deployment_error}`);
  }

  out();
  if (envs.length === 0) {
    log.info('No environments.');
    return;
  }
  printEnvsTable(envs);

  const failing = envs.filter((env) => env.status === 'failed');
  if (failing.length) {
    out();
    for (const env of failing) {
      out(`  ${c.red(sym.fail)} ${envName(env)} failed${env.last_deployed_at ? c.dim(` (${relativeTime(env.last_deployed_at)})`) : ''} — ${c.dim(`lc deployments --env ${env.name}`)}`);
    }
  }
}
