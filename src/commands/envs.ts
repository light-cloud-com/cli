import * as fs from 'node:fs';
import type { Command } from 'commander';
import type { Environment } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, heading, link, log, maskSecret, out, printDetails, relativeTime, statusBadge, sym } from '../lib/ui/output.js';
import { confirm } from '../lib/ui/prompts.js';
import { contextFrom, envName, printEnvsTable, runDeploy } from './shared.js';

interface Scoped {
  app?: string;
  env?: string;
}

export function registerEnvCommands(program: Command): void {
  program
    .command('envs [app]')
    .description('List environments of an app')
    .action(async (positional: string | undefined, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(positional);
      const org = await ctx.resolveOrg();
      const envs = await ctx.api.listEnvironments(org.id, app.id);
      emit(envs, () => {
        heading(`${app.name} ${c.dim(`· ${envs.length} environment${envs.length === 1 ? '' : 's'}`)}`);
        out();
        printEnvsTable(envs);
      });
    });

  const env = program.command('env').description('Manage one environment (create, delete, scale, vars)');

  env
    .command('get [env]')
    .description('Show one environment in detail')
    .option('-a, --app <app>', 'app name or id')
    .action(async (ref: string | undefined, options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const target = await ctx.resolveEnv(app, ref);
      const org = await ctx.resolveOrg();
      const full = await ctx.api.getEnvironment(org.id, target.id);
      emit(full, () => printEnvDetails(full));
    });

  env
    .command('create <name>')
    .description('Create an environment from a branch')
    .option('-a, --app <app>', 'app name or id')
    .option('-b, --branch <branch>', 'git branch to deploy (default: the app branch)')
    .option('--production', 'mark it as the production environment')
    .option('--no-auto-deploy', 'do not deploy automatically on push')
    .option('--deploy', 'deploy right after creating')
    .option('--memory <size>', 'container memory, e.g. 512Mi')
    .option('--min <n>', 'minimum instances')
    .option('--max <n>', 'maximum instances')
    .action(async (name: string, options: Scoped & { branch?: string; production?: boolean; autoDeploy: boolean; deploy?: boolean; memory?: string; min?: string; max?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const org = await ctx.resolveOrg();
      const created = await ctx.api.createEnvironment({
        targetOrganisationId: org.id,
        applicationId: app.id,
        name,
        githubBranch: options.branch ?? app.github_branch,
        isProduction: options.production,
        autoDeploy: options.autoDeploy,
        memory: options.memory,
        minInstances: options.min !== undefined ? Number(options.min) : undefined,
        maxInstances: options.max !== undefined ? Number(options.max) : undefined,
      });
      log.success(`Created ${c.bold(created.name)} ${c.dim(`(${created.github_branch})`)} on ${app.name}.`);
      if (options.deploy) {
        await runDeploy(ctx, { app, env: created, watch: true });
      }
      emit(created, () => {
        if (!options.deploy) log.info(`Deploy it with ${c.bold(`lc deploy --env ${created.name}`)}.`);
      });
    });

  env
    .command('delete <env>')
    .alias('rm')
    .description('Delete an environment')
    .option('-a, --app <app>', 'app name or id')
    .action(async (ref: string, options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const target = await ctx.resolveEnv(app, ref);
      const org = await ctx.resolveOrg();
      if (target.is_production) {
        log.warn('This is the production environment.');
      }
      const ok = await confirm(`Delete ${c.bold(`${app.name} / ${target.name}`)}? This cannot be undone.`, { yes: ctx.yes });
      if (!ok) return;
      await ctx.api.deleteEnvironment(org.id, target.id);
      emit({ ok: true, id: target.id, name: target.name }, () => log.success(`Deleting ${c.bold(target.name)}.`));
    });

  env
    .command('scale [env]')
    .description('Set instance limits (container apps)')
    .option('-a, --app <app>', 'app name or id')
    .option('--min <n>', 'minimum instances (1 keeps it always on)')
    .option('--max <n>', 'maximum instances')
    .action(async (ref: string | undefined, options: Scoped & { min?: string; max?: string }, command: Command) => {
      const ctx = contextFrom(command);
      if (options.min === undefined && options.max === undefined) {
        throw new CliError('Nothing to change.', { hint: 'Pass --min <n> and/or --max <n>.', exitCode: EXIT.USAGE });
      }
      const app = await ctx.resolveApp(options.app);
      const target = await ctx.resolveEnv(app, ref);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.scaleEnvironment(org.id, target.id, {
        minInstances: options.min !== undefined ? Number(options.min) : undefined,
        maxInstances: options.max !== undefined ? Number(options.max) : undefined,
      });
      emit(result, () => {
        const applied = result.applied ?? {};
        log.success(`${app.name} / ${target.name}: min ${applied.minInstances ?? result.environment?.min_instances ?? '—'}, max ${applied.maxInstances ?? result.environment?.max_instances ?? '—'}.`);
        if (result.clamped) log.warn('The minimum was clamped by your plan.');
        if (result.dedicated_addon_notice) log.info(result.dedicated_addon_notice);
      });
    });

  env
    .command('password [env]')
    .description('Gate the site behind a visitor password, or make it public again')
    .option('-a, --app <app>', 'app name or id')
    .option('--set <password>', 'password visitors must enter (6-128 characters)')
    .option('--off', 'remove the password gate')
    .action(async (ref: string | undefined, options: Scoped & { set?: string; off?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      if (!options.set && !options.off) {
        throw new CliError('Nothing to change.', { hint: 'Pass --set <password> or --off.', exitCode: EXIT.USAGE });
      }
      const app = await ctx.resolveApp(options.app);
      const target = await ctx.resolveEnv(app, ref);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.setEnvironmentPassword(org.id, target.id, options.off ? undefined : options.set);
      emit(result, () => {
        if (result.passwordEnabled) log.success(`${app.name} / ${target.name} is password protected.`);
        else log.success(`${app.name} / ${target.name} is public.`);
      });
    });

  // ---- vars ------------------------------------------------------------------

  const vars = env.command('vars').description('Environment variables');

  vars
    .command('list', { isDefault: true })
    .description('List variables (values masked unless --reveal)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--reveal', 'print values in clear')
    .action(async (options: Scoped & { reveal?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const { target, values } = await loadVars(ctx, options);
      emit(values, () => {
        const keys = Object.keys(values).sort();
        if (keys.length === 0) {
          log.info(`No variables on ${target.name}. Add one with ${c.bold('lc env vars set KEY=value')}.`);
          return;
        }
        heading(`${target.name} ${c.dim(`· ${keys.length} variable${keys.length === 1 ? '' : 's'}`)}`);
        const width = Math.max(...keys.map((key) => key.length));
        for (const key of keys) {
          out(`  ${c.bold(key.padEnd(width))}  ${options.reveal ? values[key] : c.dim(maskSecret(values[key] ?? ''))}`);
        }
        if (!options.reveal) out(c.dim('  (values masked; --reveal to show)'));
      });
    });

  vars
    .command('set <pairs...>')
    .description('Set variables: KEY=value [KEY2=value2 …]')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--redeploy', 'deploy after saving so the change takes effect')
    .action(async (pairs: string[], options: Scoped & { redeploy?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const updates = parsePairs(pairs);
      const { app, target, values } = await loadVars(ctx, options);
      const next = { ...values, ...updates };
      await saveVars(ctx, target, next);
      emit({ ok: true, set: Object.keys(updates), total: Object.keys(next).length }, () => {
        log.success(`Set ${Object.keys(updates).map((key) => c.bold(key)).join(', ')} on ${app.name} / ${target.name}.`);
      });
      await maybeRedeploy(ctx, app, target, options.redeploy);
    });

  vars
    .command('unset <keys...>')
    .description('Remove variables')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--redeploy', 'deploy after saving')
    .action(async (keys: string[], options: Scoped & { redeploy?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const { app, target, values } = await loadVars(ctx, options);
      const next = { ...values };
      const missing = keys.filter((key) => !(key in next));
      for (const key of keys) delete next[key];
      await saveVars(ctx, target, next);
      emit({ ok: true, unset: keys.filter((key) => key in values), missing }, () => {
        if (missing.length) log.warn(`Not set: ${missing.join(', ')}.`);
        const removed = keys.filter((key) => key in values);
        if (removed.length) log.success(`Removed ${removed.map((key) => c.bold(key)).join(', ')} from ${app.name} / ${target.name}.`);
      });
      await maybeRedeploy(ctx, app, target, options.redeploy);
    });

  vars
    .command('import <file>')
    .description('Load variables from a .env file (merges over existing ones)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--replace', 'replace all variables instead of merging')
    .option('--redeploy', 'deploy after saving')
    .action(async (file: string, options: Scoped & { replace?: boolean; redeploy?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        throw new CliError(`Cannot read ${file}.`, { exitCode: EXIT.USAGE });
      }
      const parsed = parseDotenv(content);
      if (Object.keys(parsed).length === 0) {
        throw new CliError(`${file} contains no KEY=value lines.`, { exitCode: EXIT.USAGE });
      }
      const { app, target, values } = await loadVars(ctx, options);
      const next = options.replace ? parsed : { ...values, ...parsed };
      await saveVars(ctx, target, next);
      emit({ ok: true, imported: Object.keys(parsed), total: Object.keys(next).length }, () => {
        log.success(`Imported ${Object.keys(parsed).length} variable${Object.keys(parsed).length === 1 ? '' : 's'} from ${file} into ${app.name} / ${target.name}.`);
      });
      await maybeRedeploy(ctx, app, target, options.redeploy);
    });

  vars
    .command('export')
    .description('Print variables in .env format (redirect to a file)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const { values } = await loadVars(ctx, options);
      emit(values, () => {
        for (const key of Object.keys(values).sort()) {
          process.stdout.write(`${key}=${quoteDotenv(values[key] ?? '')}\n`);
        }
      });
    });
}

// ---- helpers ------------------------------------------------------------------

async function loadVars(ctx: ReturnType<typeof contextFrom>, options: Scoped) {
  const app = await ctx.resolveApp(options.app);
  const target = await ctx.resolveEnv(app, options.env);
  const org = await ctx.resolveOrg();
  const full = await ctx.api.getEnvironment(org.id, target.id);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(full.environment_vars ?? {})) {
    values[key] = value == null ? '' : String(value);
  }
  return { app, target: full, values };
}

async function saveVars(ctx: ReturnType<typeof contextFrom>, target: Environment, values: Record<string, string>): Promise<void> {
  const org = await ctx.resolveOrg();
  await ctx.api.updateEnvironment({ targetOrganisationId: org.id, environmentId: target.id, environmentVars: values });
}

async function maybeRedeploy(ctx: ReturnType<typeof contextFrom>, app: Awaited<ReturnType<typeof loadVars>>['app'], target: Environment, redeploy?: boolean): Promise<void> {
  if (redeploy) {
    await runDeploy(ctx, { app, env: target, watch: true });
  } else {
    log.info(`Changes apply on the next deploy ${c.dim(`(lc deploy --env ${target.name}, or pass --redeploy)`)}.`);
  }
}

export function parsePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index <= 0) {
      throw new CliError(`"${pair}" is not KEY=value.`, { exitCode: EXIT.USAGE });
    }
    const key = pair.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new CliError(`"${key}" is not a valid variable name.`, { hint: 'Letters, digits and underscores; cannot start with a digit.', exitCode: EXIT.USAGE });
    }
    result[key] = pair.slice(index + 1);
  }
  return result;
}

export function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const comment = value.indexOf(' #');
      if (comment !== -1) value = value.slice(0, comment);
      value = value.trim();
    }
    result[match[1]!] = value;
  }
  return result;
}

export function quoteDotenv(value: string): string {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function printEnvDetails(env: Environment): void {
  heading(`${envName(env)}  ${statusBadge(env.status)}`);
  printDetails([
    ['Branch', env.github_branch],
    ['URL', env.deployed_url ? link(env.deployed_url) : undefined],
    ['Domain', env.custom_domain ? `${env.custom_domain} ${c.dim(env.custom_domain_status ?? '')}` : undefined],
    ['Auto-deploy', env.auto_deploy ? 'on push' : 'off'],
    ['Build', env.build_command ?? undefined],
    ['Output', env.output_directory ?? undefined],
    ['Port', env.container_port != null ? String(env.container_port) : undefined],
    ['Memory', env.memory ?? undefined],
    ['Instances', env.min_instances != null || env.max_instances != null ? `${env.min_instances ?? 0} ${c.dim(sym.arrow)} ${env.max_instances ?? '?'}` : undefined],
    ['Password', env.password_enabled ? 'protected' : undefined],
    ['Variables', `${Object.keys(env.environment_vars ?? {}).length}`],
    ['Last deploy', relativeTime(env.last_deployed_at)],
    ['ID', c.dim(env.id)],
  ]);
}
