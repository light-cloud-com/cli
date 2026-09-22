import * as fs from 'node:fs';
import type { Command } from 'commander';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, heading, log, out, printDetails, printTable, relativeTime, statusBadge } from '../lib/ui/output.js';
import { confirm } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

/*
 * Everything the console can do that the CLI could not (2026-09-15):
 * app and environment settings, folders, stacks, database admin, billing
 * beyond the plan, workspace members, profile, devices, git providers,
 * API keys, notifications, support. Console-only by design: the account
 * password, two-factor, and the Agents & CLI switch itself.
 */

type Rec = Record<string, unknown>;
const rows = (value: unknown): Rec[] => {
  if (Array.isArray(value)) return value as Rec[];
  const v = value as Rec | null;
  for (const key of ['data', 'items', 'rows', 'users', 'roles', 'keys', 'notifications', 'invoices', 'projects', 'sessions', 'repositories', 'installations', 'directories']) {
    if (v && Array.isArray(v[key])) return v[key] as Rec[];
  }
  return [];
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const changesFrom = (options: Rec, map: Record<string, string>, numbers: string[] = []): Rec => {
  const changes: Rec = {};
  for (const [flag, field] of Object.entries(map)) {
    if (options[flag] !== undefined) changes[field] = numbers.includes(flag) ? Number(options[flag]) : options[flag];
  }
  return changes;
};
const requireChanges = (changes: Rec, hint: string): void => {
  if (Object.keys(changes).length === 0) throw new CliError('Nothing to change.', { hint, exitCode: EXIT.USAGE });
};
const printRecord = (value: unknown): void => {
  const v = (value ?? {}) as Rec;
  printDetails(Object.entries(v).filter(([, x]) => x !== null && typeof x !== 'object').map(([k, x]) => [k, str(x)] as [string, string]));
};

export function registerParityCommands(program: Command): void {
  // ---- app settings ----------------------------------------------------------
  const app = program.command('app').description('One app: settings and folder');

  app
    .command('update <app>')
    .description('Change build settings and defaults (only the flags given change)')
    .option('--framework <id>', 'framework id (see lc frameworks)')
    .option('--build <command>', 'build command')
    .option('--output <dir>', 'output directory (static sites)')
    .option('--root <dir>', 'monorepo root directory')
    .option('--runtime <id>', 'runtime for containers')
    .option('--port <port>', 'container port')
    .option('--memory <size>', 'default memory, e.g. 512Mi')
    .option('--cpu <n>', 'default cpu')
    .option('--min <n>', 'default minimum instances')
    .option('--max <n>', 'default maximum instances')
    .option('--auto-deploy-branches <list>', 'comma-separated branches that deploy on push')
    .option('--github-checks <on|off>', 'post a check run on GitHub commits')
    .option('--github-pr-comments <on|off>', 'sticky deploy comment on pull requests')
    .action(async (ref: string, options: Rec, command: Command) => {
      const ctx = contextFrom(command);
      const target = await ctx.resolveApp(ref);
      const org = await ctx.resolveOrg();
      const changes = changesFrom(options, {
        framework: 'framework', build: 'buildCommand', output: 'outputDirectory', root: 'rootDirectory', runtime: 'runtime',
        port: 'containerPort', memory: 'memory', cpu: 'cpu', min: 'minInstances', max: 'maxInstances',
      }, ['port', 'min', 'max']);
      if (options.autoDeployBranches !== undefined) changes.autoDeployBranches = String(options.autoDeployBranches).split(',').map((b) => b.trim()).filter(Boolean);
      if (options.githubChecks !== undefined) changes.githubChecksEnabled = options.githubChecks === 'on';
      if (options.githubPrComments !== undefined) changes.githubPrCommentsEnabled = options.githubPrComments === 'on';
      requireChanges(changes, 'Pass at least one flag, e.g. --build "npm run build".');
      const result = await ctx.api.updateApplication(org.id, target.id, changes);
      emit(result, () => log.success(`${target.name} updated. Redeploy for build changes to take effect.`));
    });

  app
    .command('move <app>')
    .description('Move an app into a folder, or back to the workspace root')
    .option('--folder <id>', 'target folder id (see lc folders); omit for the root')
    .action(async (ref: string, options: { folder?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const target = await ctx.resolveApp(ref);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.moveApplication(org.id, target.id, options.folder ?? null);
      emit(result, () => log.success(`${target.name} moved ${options.folder ? `to folder ${options.folder}` : 'to the root'}.`));
    });

  app
    .command('repo-dirs <owner/repo>')
    .description('Folders in a repository branch, for --root on monorepos')
    .option('-b, --branch <branch>', 'branch', 'main')
    .option('-p, --path <path>', 'folder to list (default: the root)')
    .option('--provider <name>', 'github, gitlab or bitbucket')
    .action(async (slug: string, options: { branch: string; path?: string; provider?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const [owner, repo] = slug.split('/');
      if (!owner || !repo) throw new CliError('Pass owner/repo.', { exitCode: EXIT.USAGE });
      const result = await ctx.api.listRepoDirectories(org.id, owner, repo, options.branch, options.path, options.provider);
      emit(result, () => {
        const dirs = rows(result);
        if (dirs.length === 0) return log.info('No folders here.');
        for (const d of dirs) out(`  ${str(d.path ?? d.name)}`);
      });
    });

  // ---- environment settings / insight -----------------------------------------
  const env = program.commands.find((cmd) => cmd.name() === 'env');
  if (env) {
    env
      .command('update [env]')
      .description('Change settings (only the flags given change)')
      .option('-a, --app <app>', 'app name or id')
      .option('--name <name>', 'rename the environment')
      .option('--build <command>', 'build command')
      .option('--output <dir>', 'output directory')
      .option('--port <port>', 'container port')
      .option('--memory <size>', 'memory, e.g. 512Mi')
      .option('--cpu <n>', 'cpu')
      .option('--min <n>', 'minimum instances')
      .option('--max <n>', 'maximum instances')
      .option('--auto-deploy <on|off>', 'redeploy on push to the branch')
      .action(async (ref: string | undefined, options: Rec & { app?: string }, command: Command) => {
        const ctx = contextFrom(command);
        const target = await ctx.resolveApp(options.app);
        const environment = await ctx.resolveEnv(target, ref);
        const org = await ctx.resolveOrg();
        const changes = changesFrom(options, {
          name: 'name', build: 'buildCommand', output: 'outputDirectory', port: 'containerPort', memory: 'memory', cpu: 'cpu', min: 'minInstances', max: 'maxInstances',
        }, ['port', 'min', 'max']);
        if (options.autoDeploy !== undefined) changes.autoDeploy = options.autoDeploy === 'on';
        requireChanges(changes, 'Pass at least one flag, e.g. --memory 1Gi.');
        const result = await ctx.api.updateEnvironmentSettings(org.id, environment.id, changes);
        emit(result, () => log.success(`${target.name} / ${environment.name} updated.`));
      });

    env
      .command('metrics [env]')
      .description('Requests, latency, errors, instances, cpu and memory')
      .option('-a, --app <app>', 'app name or id')
      .option('--range <range>', '1h, 6h, 24h or 7d', '24h')
      .action(async (ref: string | undefined, options: { app?: string; range: string }, command: Command) => {
        const ctx = contextFrom(command);
        const target = await ctx.resolveApp(options.app);
        const environment = await ctx.resolveEnv(target, ref);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.environmentMetrics(org.id, environment.id, options.range);
        emit(result, () => { heading(`${target.name} / ${environment.name} · last ${options.range}`); printRecord((result as Rec).summary ?? result); });
      });

    env
      .command('activity [env]')
      .description('Who changed what, newest first')
      .option('-a, --app <app>', 'app name or id')
      .option('-n, --limit <n>', 'how many', '30')
      .action(async (ref: string | undefined, options: { app?: string; limit: string }, command: Command) => {
        const ctx = contextFrom(command);
        const target = await ctx.resolveApp(options.app);
        const environment = await ctx.resolveEnv(target, ref);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.environmentActivity(org.id, environment.id, Number(options.limit));
        emit(result, () => {
          const items = rows(result);
          if (items.length === 0) return log.info('No activity yet.');
          printTable(items, [
            { header: 'When', cell: (r) => relativeTime(str(r.created_at ?? r.occurred_at)) },
            { header: 'Who', cell: (r) => str((r.actor as Rec | undefined)?.email ?? r.actor_email ?? r.actor) },
            { header: 'What', cell: (r) => str(r.summary ?? r.action ?? r.type) },
          ]);
        });
      });

    env
      .command('runtime [env]')
      .description('What is running now: live deployment, instances, size, region')
      .option('-a, --app <app>', 'app name or id')
      .action(async (ref: string | undefined, options: { app?: string }, command: Command) => {
        const ctx = contextFrom(command);
        const target = await ctx.resolveApp(options.app);
        const environment = await ctx.resolveEnv(target, ref);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.environmentRuntime(org.id, environment.id);
        emit(result, () => { heading(`${target.name} / ${environment.name}`); printRecord(result); });
      });
  }

  // ---- folders -----------------------------------------------------------------
  program
    .command('folders')
    .description('Folders (projects) that group apps and databases')
    .option('--parent <id>', 'list inside this folder')
    .action(async (options: { parent?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.listFolders(org.id, options.parent);
      emit(result, () => {
        const items = rows(result);
        if (items.length === 0) return log.info(`No folders. Create one with ${c.bold('lc folder create <name>')}.`);
        printTable(items, [
          { header: 'Name', cell: (r) => str(r.name) },
          { header: 'ID', cell: (r) => c.dim(str(r.id)) },
        ]);
      });
    });
  const folder = program.command('folder').description('Manage one folder');
  folder
    .command('create <name>')
    .option('--parent <id>', 'create inside this folder')
    .description('Create a folder')
    .action(async (name: string, options: { parent?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.createFolder(org.id, name, options.parent);
      emit(result, () => log.success(`Folder ${c.bold(name)} created ${c.dim(str((result as Rec).id))}.`));
    });
  folder
    .command('delete <id>')
    .alias('rm')
    .description('Delete an empty folder')
    .action(async (id: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.deleteFolder(org.id, id);
      emit(result, () => log.success('Folder deleted.'));
    });

  // ---- stacks -------------------------------------------------------------------
  const stack = program.command('stack').description('Apps from stack templates (e.g. Open SaaS)');
  stack
    .command('create <stackId>')
    .description('Create and deploy an app from a stack template')
    .requiredOption('-n, --name <name>', 'app name')
    .option('--repo-name <name>', 'repository to create in the connected GitHub account')
    .option('--region <region>', 'region')
    .option('--folder <id>', 'folder id')
    .option('--env <pairs...>', 'environment variables KEY=value')
    .action(async (stackId: string, options: { name: string; repoName?: string; region?: string; folder?: string; env?: string[] }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const environmentVars: Record<string, string> = {};
      for (const pair of options.env ?? []) {
        const at = pair.indexOf('=');
        if (at > 0) environmentVars[pair.slice(0, at)] = pair.slice(at + 1);
      }
      const result = await ctx.api.createStack(org.id, stackId, { name: options.name, repoName: options.repoName, region: options.region, projectId: options.folder, environmentVars });
      emit(result, () => log.success(`Stack ${stackId} is being set up as ${c.bold(options.name)}. Follow it with ${c.bold(`lc status ${options.name}`)}.`));
    });

  // ---- database admin ---------------------------------------------------------
  const db = program.commands.find((cmd) => cmd.name() === 'db');
  if (db) {
    db
      .command('update <name>')
      .description('Change name, tier, region, storage or high availability')
      .option('--name <name>', 'new name')
      .option('--tier <tier>', 'machine tier id (see lc db tiers)')
      .option('--region <region>', 'region id')
      .option('--storage <gb>', 'storage in GB')
      .option('--ha', 'enable high availability')
      .option('--no-ha', 'disable high availability')
      .action(async (ref: string, options: Rec, command: Command) => {
        const ctx = contextFrom(command);
        const database = await ctx.resolveDb(ref);
        const org = await ctx.resolveOrg();
        const changes = changesFrom(options, { name: 'name', tier: 'tier', region: 'region', storage: 'storageGb' }, ['storage']);
        if (options.ha !== undefined) changes.haEnabled = options.ha;
        requireChanges(changes, 'Pass at least one flag, e.g. --storage 50.');
        const result = await ctx.api.updateDatabase(org.id, database.id, changes);
        emit(result, () => log.success(`${database.name} updated.`));
      });
    db
      .command('metrics [name]')
      .description('Connections, cpu, memory, storage and query load')
      .option('--range <range>', '1h, 6h, 24h or 7d', '1h')
      .action(async (ref: string | undefined, options: { range: string }, command: Command) => {
        const ctx = contextFrom(command);
        const database = await ctx.resolveDb(ref);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.databaseMetrics(org.id, database.id, options.range);
        emit(result, () => { heading(`${database.name} · last ${options.range}`); printRecord((result as Rec).summary ?? result); });
      });
    db
      .command('schema [name]')
      .description('Schemas, tables, columns and row counts')
      .action(async (ref: string | undefined, _options: unknown, command: Command) => {
        const ctx = contextFrom(command);
        const database = await ctx.resolveDb(ref);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.databaseSchema(org.id, database.id);
        emit(result, () => {
          const tables = rows((result as Rec).tables ?? result);
          if (tables.length === 0) return log.info('No tables.');
          printTable(tables, [
            { header: 'Table', cell: (r) => `${str(r.schema ?? 'public')}.${str(r.name ?? r.table)}` },
            { header: 'Rows', cell: (r) => str(r.rowCount ?? r.rows ?? ''), align: 'right' },
            { header: 'Columns', cell: (r) => str(Array.isArray(r.columns) ? (r.columns as Rec[]).length : r.columnCount ?? '') , align: 'right' },
          ]);
        });
      });
    db
      .command('query <sql>')
      .description('Run SQL (read-only unless --write)')
      .option('-d, --db <name>', 'database name or id')
      .option('--write', 'allow statements that change data')
      .action(async (sql: string, options: { db?: string; write?: boolean }, command: Command) => {
        const ctx = contextFrom(command);
        const database = await ctx.resolveDb(options.db);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.queryDatabase(org.id, database.id, sql, options.write === true);
        emit(result, () => {
          const data = result as Rec;
          const list = rows(data.rows ?? data);
          if (list.length === 0) return log.info(`Done${data.rowCount !== undefined ? ` (${str(data.rowCount)} rows affected)` : ''}.`);
          const columns = Object.keys(list[0] ?? {}).map((key) => ({ header: key, cell: (r: Rec) => str(r[key]) }));
          printTable(list, columns);
        });
      });
    db
      .command('import <file>')
      .description('Load a .sql or .sql.gz dump into a database (existing data is kept)')
      .option('-d, --db <name>', 'database name or id')
      .action(async (file: string, options: { db?: string }, command: Command) => {
        const ctx = contextFrom(command);
        const database = await ctx.resolveDb(options.db);
        const org = await ctx.resolveOrg();
        if (!fs.existsSync(file)) throw new CliError(`${file} does not exist.`, { exitCode: EXIT.USAGE });
        const ok = await confirm(`Import ${file} into ${database.name}? Statements run as-is.`, { yes: ctx.yes, initialValue: false });
        if (!ok) return;
        const body = new Uint8Array(fs.readFileSync(file));
        const result = await ctx.api.importDatabase(org.id, database.id, body, file.endsWith('.gz'));
        emit(result, () => log.success(`Imported ${file} into ${database.name}.`));
      });
  }

  // ---- billing beyond the plan --------------------------------------------------
  const billing = program.commands.find((cmd) => cmd.name() === 'billing');
  if (billing) {
    billing
      .command('usage')
      .description('Usage this cycle against what the plan includes, per resource')
      .action(async (_options: unknown, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        const { data } = await ctx.api.plans(org.id);
        const money = (n: number) => `$${n.toFixed(2)}`;
        const rows = [...(data.resources?.running ?? []).map((r) => ({ ...r, state: 'running' })), ...(data.resources?.removed ?? []).map((r) => ({ ...r, state: 'removed' }))];
        emit({ pool: data.pool, hardStopped: data.hardStopped, resources: data.resources }, () => {
          heading(org.name ?? org.id);
          printDetails([
            ['Usage', `${money(data.pool.spent)} of ${money(data.pool.total)} included (${Math.round((data.pool.pct ?? 0) * 100)}%)`],
            ['Extra usage', data.pool.overage > 0 ? `${money(data.pool.overage)} — goes on the next invoice` : undefined],
            ['Left', data.pool.overage > 0 ? undefined : money(data.pool.remaining)],
          ]);
          if (data.hardStopped) log.warn("The free plan's included usage is used up — projects are paused until an upgrade or the next cycle.");
          if (rows.length === 0) return out(c.dim('  Nothing has used anything this cycle.'));
          out();
          printTable(rows, [
            { header: 'Resource', cell: (r) => r.name },
            { header: 'Kind', cell: (r) => r.machine ?? r.kind },
            { header: 'State', cell: (r) => r.state },
            { header: 'Used', cell: (r) => money(r.costThisCycle) },
          ]);
        });
      });
    billing
      .command('history')
      .description('Usage over previous cycles')
      .option('--days <n>', 'window', '90')
      .action(async (options: { days: string }, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.usageHistory(org.id, Number(options.days));
        emit(result, () => {
          const items = rows((result as Rec).data ?? result);
          if (items.length === 0) return log.info('No history yet.');
          printTable(items, [
            { header: 'Cycle', cell: (r) => str(r.period ?? r.cycle_start ?? r.date) },
            { header: 'Used', cell: (r) => str(r.total ?? r.used ?? r.amount), align: 'right' },
          ]);
        });
      });
    billing
      .command('invoices')
      .description('Invoices, newest first')
      .option('--status <status>', 'paid, open, failed …')
      .option('-n, --limit <n>', 'how many', '20')
      .action(async (options: { status?: string; limit: string }, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        const result = await ctx.api.invoices(org.id, Number(options.limit), options.status);
        emit(result, () => {
          const items = rows((result as Rec).data ?? result);
          if (items.length === 0) return log.info('No invoices.');
          printTable(items, [
            { header: 'Invoice', cell: (r) => str(r.number ?? r.id) },
            { header: 'Date', cell: (r) => str(r.created_at ?? r.date).slice(0, 10) },
            { header: 'Total', cell: (r) => str(r.total), align: 'right' },
            { header: 'Status', cell: (r) => statusBadge(str(r.status)) },
          ]);
        });
      });
    billing
      .command('invoice <id>')
      .description('One invoice with its lines')
      .option('--retry', 'charge the card on file again for a failed invoice')
      .action(async (id: string, options: { retry?: boolean }, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        const result = options.retry ? await ctx.api.retryInvoice(org.id, id) : await ctx.api.invoice(org.id, id);
        emit(result, () => (options.retry ? log.success('Payment retried.') : printRecord((result as Rec).data ?? result)));
      });
    billing
      .command('outstanding')
      .description('Unpaid invoices across the workspaces you own')
      .action(async (_options: unknown, command: Command) => {
        const ctx = contextFrom(command);
        const result = await ctx.api.outstanding();
        emit(result, () => {
          const items = rows((result as Rec).data ?? result);
          if (items.length === 0) return log.success('Nothing outstanding.');
          printTable(items, [
            { header: 'Workspace', cell: (r) => str(r.organisation_name ?? r.organisationName ?? r.organisation_id) },
            { header: 'Invoice', cell: (r) => str(r.number ?? r.id) },
            { header: 'Total', cell: (r) => str(r.total), align: 'right' },
          ]);
        });
      });
    billing
      .command('alerts')
      .alias('limit')
      .description('Usage alerts: the 80% and 100% emails always send; add one extra alert at a dollar amount of usage this cycle')
      .option('--at <usd>', 'email when usage this cycle passes this amount')
      .option('--clear', 'remove the extra alert')
      .action(async (options: { at?: string; clear?: boolean }, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        if (options.at === undefined && !options.clear) {
          const current = await ctx.api.billingSettings(org.id);
          const data = ((current as Rec).data ?? current) as Rec;
          const included = typeof data.paid_monthly === 'number' ? data.paid_monthly : data.spending_limit;
          return emit(current, () => {
            printDetails([
              ['Included usage', typeof included === 'number' ? `$${Number(included).toFixed(2)} this cycle (set by the plan)` : 'not set'],
              ['Emails', 'at 80% and when it is used up — always'],
              ['Extra alert', typeof data.budget_alert_threshold === 'number' ? `at $${Number(data.budget_alert_threshold).toFixed(2)} of usage` : 'none (lc billing alerts --at <usd>)'],
              ['Used up', data.cap_reached ? 'yes' : 'no'],
            ]);
          });
        }
        const settings: Rec = { budget_alert_threshold: options.clear ? null : Number(options.at) };
        const result = await ctx.api.setBillingSettings(org.id, settings);
        emit(result, () => log.success(options.clear ? 'Extra usage alert removed.' : `Extra usage alert set at $${Number(options.at).toFixed(2)}.`));
      });
    billing
      .command('details')
      .description('Show or set the billing address and tax ids on invoices')
      .option('--set <pairs...>', 'fields as key=value: company_name, billing_email, phone, first_name, last_name, street, street_number, apartment, city, post_code, country, tin, vat_number, is_company')
      .action(async (options: { set?: string[] }, command: Command) => {
        const ctx = contextFrom(command);
        const org = await ctx.resolveOrg();
        if (!options.set?.length) {
          const current = await ctx.api.billingDetails(org.id);
          return emit(current, () => printRecord((current as Rec).data ?? current));
        }
        const map: Record<string, string> = {
          company_name: 'company_name', billing_email: 'billing_email', phone: 'phone', first_name: 'address_first_name', last_name: 'address_last_name',
          street: 'address_street', street_number: 'address_street_number', apartment: 'address_apartment_number', city: 'address_city',
          post_code: 'address_post_code', country: 'address_country', tin: 'tin', vat_number: 'vat_number', is_company: 'is_company',
        };
        const details: Rec = {};
        for (const pair of options.set) {
          const at = pair.indexOf('=');
          const key = pair.slice(0, at);
          if (!map[key]) throw new CliError(`Unknown field ${key}.`, { hint: `Fields: ${Object.keys(map).join(', ')}`, exitCode: EXIT.USAGE });
          const value = pair.slice(at + 1);
          details[map[key]] = key === 'is_company' ? value === 'true' : value;
        }
        const result = await ctx.api.setBillingDetails(org.id, details);
        emit(result, () => log.success('Billing details saved.'));
      });
  }

  // ---- workspaces, members, roles ---------------------------------------------
  const org = program.commands.find((cmd) => cmd.name() === 'org');
  if (org) {
    org
      .command('create <name>')
      .description('Create a new workspace on the free plan')
      .action(async (name: string, _options: unknown, command: Command) => {
        const ctx = contextFrom(command);
        const result = await ctx.api.createOrganisation(name);
        emit(result, () => log.success(`Workspace ${c.bold(name)} created. Switch to it with ${c.bold(`lc org use ${name}`)}.`));
      });
  }
  program
    .command('members')
    .description('Members of the workspace with their roles')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.members(o.id);
      emit(result, () => {
        const items = rows(result);
        printTable(items, [
          { header: 'Email', cell: (r) => str(r.email ?? (r.user as Rec | undefined)?.email) },
          { header: 'Name', cell: (r) => `${str(r.first_name ?? (r.user as Rec | undefined)?.first_name)} ${str(r.last_name ?? (r.user as Rec | undefined)?.last_name)}`.trim() },
          { header: 'Role', cell: (r) => str(typeof r.role === 'object' && r.role ? (r.role as Rec).name : r.role) },
          { header: 'ID', cell: (r) => c.dim(str(r.user_id ?? r.id)) },
        ]);
      });
    });
  const member = program.command('member').description('Invite, remove, change a member');
  member
    .command('invite <email>')
    .requiredOption('-r, --role <role>', 'role name (see lc roles)')
    .description('Invite by email; the seat is active once they sign in')
    .action(async (email: string, options: { role: string }, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.inviteMember(o.id, email, options.role);
      emit(result, () => log.success(`Invited ${email} as ${options.role}.`));
    });
  member
    .command('remove <userId>')
    .description('Remove a member')
    .action(async (userId: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const ok = await confirm(`Remove ${userId} from ${o.name ?? 'the workspace'}?`, { yes: ctx.yes, initialValue: false });
      if (!ok) return;
      const result = await ctx.api.removeMember(o.id, userId);
      emit(result, () => log.success('Member removed.'));
    });
  member
    .command('role <userId> <role>')
    .description("Change a member's role")
    .action(async (userId: string, role: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.setMemberRole(o.id, userId, role);
      emit(result, () => log.success(`Role set to ${role}.`));
    });
  program
    .command('roles')
    .description('Roles available in the workspace')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.roles(o.id);
      emit(result, () => {
        const items = rows(result);
        printTable(items, [
          { header: 'Role', cell: (r) => str(r.name) },
          { header: 'Description', cell: (r) => str(r.description ?? '') },
        ]);
      });
    });

  // ---- profile, devices, agent access ----------------------------------------
  program
    .command('profile')
    .description('Show or change your name and time zone')
    .option('--first-name <name>')
    .option('--last-name <name>')
    .option('--timezone <zone>', 'IANA zone, e.g. Europe/Warsaw')
    .action(async (options: { firstName?: string; lastName?: string; timezone?: string }, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      const profile = await ctx.api.profile();
      if (options.firstName === undefined && options.lastName === undefined && options.timezone === undefined) {
        return emit(profile, () => printDetails([['Email', profile.email], ['Name', `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()], ['Time zone', str((profile as unknown as Rec).timezone)]]));
      }
      if (options.firstName !== undefined || options.lastName !== undefined) {
        await ctx.api.setProfileName(options.firstName ?? profile.first_name ?? '', options.lastName ?? profile.last_name ?? '');
      }
      if (options.timezone !== undefined) await ctx.api.setTimezone(options.timezone);
      emit({ ok: true }, () => log.success('Profile updated.'));
    });
  program
    .command('devices')
    .description('Every signed-in session: browsers, the CLI, MCP servers, VS Code')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      const result = await ctx.api.sessions();
      emit(result, () => {
        printTable(result.sessions, [
          { header: 'Client', cell: (r) => r.clientName ?? (r.source === 'browser' ? 'Browser' : r.source) },
          { header: 'Source', cell: (r) => r.source },
          { header: 'Last active', cell: (r) => relativeTime(r.lastActiveAt) },
          { header: 'ID', cell: (r) => c.dim(r.id) + (r.current ? c.accent(' (this)') : '') },
        ]);
      });
    });
  const device = program.command('device').description('Sign a session out');
  device
    .command('sign-out <sessionId>')
    .description('Sign one session out (see lc devices)')
    .action(async (sessionId: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      const result = await ctx.api.revokeSession(sessionId);
      emit(result, () => log.success('Signed out. It stops working within fifteen minutes.'));
    });
  program
    .command('agent-access')
    .description('What this account lets agents (CLI, MCP, VS Code) do — changed in the console')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      const result = await ctx.api.agentAccess();
      emit(result, () => {
        heading(result.enabled ? 'Agent access: on' : 'Agent access: OFF');
        for (const group of result.groups) {
          const allowed = !result.blocked.includes(group);
          out(`  ${allowed ? c.green('allowed') : c.red('blocked')}  ${result.labels[group] ?? group}`);
        }
        out();
        log.info(`Change it under Settings › Security › Agents & CLI: ${ctx.consoleUrl('/settings?tab=security')}`);
      });
    });

  // ---- git providers ----------------------------------------------------------
  const git = program.command('git').description('Connect GitLab or Bitbucket; GitHub uses the App install link');
  git
    .command('connect <provider>')
    .description('One link to sign in and authorise gitlab or bitbucket for this workspace')
    .action(async (provider: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      if (provider === 'github') {
        const install = await ctx.api.githubInstallUrl();
        return emit(install, () => { log.info('Install the Light Cloud GitHub App:'); out(`  ${install.url}`); });
      }
      if (provider !== 'gitlab' && provider !== 'bitbucket') throw new CliError('Provider must be github, gitlab or bitbucket.', { exitCode: EXIT.USAGE });
      const result = await ctx.api.gitProviderConnectUrl(provider, o.id);
      emit(result, () => { log.info(`Open this link to connect ${provider}:`); out(`  ${result.url}`); });
    });
  git
    .command('repos <provider>')
    .description('Repositories reachable through a connected provider')
    .action(async (provider: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      if (provider !== 'gitlab' && provider !== 'bitbucket') throw new CliError('Provider must be gitlab or bitbucket.', { exitCode: EXIT.USAGE });
      const result = await ctx.api.gitProviderRepositories(provider, o.id);
      emit(result, () => {
        const items = rows(result);
        if (items.length === 0) return log.info('No repositories visible. Connect the provider first: lc git connect ' + provider);
        for (const r of items) out(`  ${str(r.full_name ?? r.path_with_namespace ?? r.name)}`);
      });
    });
  git
    .command('github-status')
    .description('GitHub App installations linked to this workspace')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.githubInstallations(o.id);
      emit(result, () => {
        const items = rows(result);
        if (items.length === 0) return log.info(`No GitHub App installation linked. Get the link with ${c.bold('lc git connect github')}.`);
        for (const r of items) out(`  ${str(r.account_login ?? r.accountLogin ?? r.account)} ${c.dim(str(r.repository_selection ?? ''))}`);
      });
    });

  // ---- API keys ------------------------------------------------------------------
  program
    .command('keys')
    .description('API keys of the workspace (paid plans)')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.apiKeys(o.id);
      emit(result, () => {
        const items = rows(result);
        if (items.length === 0) return log.info(`No API keys. Create one with ${c.bold('lc key create <name>')}.`);
        printTable(items, [
          { header: 'Name', cell: (r) => str(r.name) },
          { header: 'Role', cell: (r) => str(r.role) },
          { header: 'Prefix', cell: (r) => str(r.prefix ?? r.key_prefix) },
          { header: 'Last used', cell: (r) => relativeTime(str(r.last_used_at ?? '') || null) },
          { header: 'ID', cell: (r) => c.dim(str(r.id)) },
        ]);
      });
    });
  const key = program.command('key').description('Create or revoke an API key');
  key
    .command('create <name>')
    .description('Create a key for CI and other machines (paid plans; the secret is shown once)')
    .option('-r, --role <role>', 'admin or user', 'user')
    .option('--expires <date>', 'ISO date; omit for no expiry')
    .action(async (name: string, options: { role: string; expires?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.createApiKey(o.id, name, options.role, options.expires);
      emit(result, () => {
        const secret = str(result.key ?? result.secret ?? result.token);
        log.success(`Key ${c.bold(name)} created. Copy it now; it is not shown again.`);
        out(`  ${secret}`);
        out();
        log.info(`Use it with ${c.bold('lc login --api-key <key>')} or ${c.bold('LIGHT_CLOUD_API_KEY')}.`);
      });
    });
  key
    .command('revoke <id>')
    .description('Revoke a key; anything using it stops at once')
    .action(async (id: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const o = await ctx.resolveOrg();
      const result = await ctx.api.revokeApiKey(o.id, id);
      emit(result, () => log.success('Key revoked.'));
    });

  // ---- notifications & support -----------------------------------------------
  program
    .command('notifications')
    .description('Account notifications, newest first')
    .option('--unread', 'unread only')
    .option('--read [id]', 'mark one (or all) as read')
    .option('-n, --limit <n>', 'how many', '20')
    .action(async (options: { unread?: boolean; read?: string | boolean; limit: string }, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      if (options.read !== undefined) {
        const result = await ctx.api.markNotificationsRead(typeof options.read === 'string' ? options.read : undefined);
        return emit(result, () => log.success(typeof options.read === 'string' ? 'Marked as read.' : 'All marked as read.'));
      }
      const result = await ctx.api.notifications(options.unread === true, Number(options.limit));
      emit(result, () => {
        const items = rows(result);
        if (items.length === 0) return log.info('No notifications.');
        printTable(items, [
          { header: 'When', cell: (r) => relativeTime(str(r.created_at)) },
          { header: '', cell: (r) => (r.read || r.is_read ? ' ' : c.accent('•')) },
          { header: 'Message', cell: (r) => str(r.title ?? r.message) },
          { header: 'ID', cell: (r) => c.dim(str(r.id)) },
        ]);
      });
    });
  program
    .command('support <subject>')
    .description('Send a message to Light Cloud support')
    .requiredOption('-m, --message <text>', 'the message')
    .option('--feature', 'file it as a feature request')
    .action(async (subject: string, options: { message: string; feature?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      ctx.requireAuth();
      const result = await ctx.api.contactSupport(options.feature ? 'feature_request' : 'support', subject, options.message);
      emit(result, () => log.success('Sent. We answer by email.'));
    });
}
