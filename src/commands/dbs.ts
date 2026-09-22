import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Command } from 'commander';
import type { Database } from '../lib/api/types.js';
import type { Context } from '../lib/context.js';
import { CliError, EXIT } from '../lib/errors.js';
import { watchResource } from '../lib/realtime/watch.js';
import { brand, c, emit, formatBytes, heading, isJson, log, maskSecret, out, printDetails, relativeTime, statusBadge, sym } from '../lib/ui/output.js';
import { confirm, intro, outro, select, spinner, text } from '../lib/ui/prompts.js';
import { contextFrom, printDbsTable } from './shared.js';

export function registerDbCommands(program: Command): void {
  program
    .command('dbs')
    .alias('databases')
    .description('List databases in the workspace')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const dbs = await ctx.api.listDatabases(org.id);
      emit(dbs, () => {
        if (dbs.length === 0) {
          log.info(`No databases yet. Create one with ${c.bold('lc db create')}.`);
          return;
        }
        heading(`${org.name ?? 'Workspace'} ${c.dim(`· ${dbs.length} database${dbs.length === 1 ? '' : 's'}`)}`);
        out();
        printDbsTable(dbs);
      });
    });

  const db = program.command('db').description('Manage one database');

  db
    .command('get [name]')
    .alias('show')
    .description('Show a database')
    .action(async (ref: string | undefined, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const database = await ctx.resolveDb(ref);
      emit(database, () => printDb(database, ctx.dbConsoleUrl(database)));
    });

  db
    .command('create [name]')
    .description('Create a database')
    .option('--engine <type>', 'postgresql or mysql')
    .option('--tier <tier>', 'machine tier id (see `lc db tiers`)')
    .option('--region <region>', 'region id')
    .option('--storage <gb>', 'storage in GB')
    .option('--ha', 'high availability')
    .option('--no-watch', 'do not wait for provisioning')
    .action(async (name: string | undefined, options: { engine?: string; tier?: string; region?: string; storage?: string; ha?: boolean; watch: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      intro(`${brand()} database`);

      const config = await ctx.api.platformConfig().catch(() => null);
      const types = (config?.database?.types ?? []).filter((t) => t.available);
      const tiers = (config?.database?.machineTypes ?? []).filter((t) => t.available);
      const regions = (config?.database?.regions ?? []).filter((r) => r.available);

      const chosenName = name ?? (await text('Database name', { flag: '<name>', placeholder: 'my-app-db', validate: (v) => (v.trim().length < 2 ? 'At least 2 characters.' : undefined) }));
      const engine = options.engine ?? (types.length ? await select('Engine', types.map((t) => ({ value: t.id, label: t.label })), { flag: '--engine <type>', initialValue: 'postgresql' }) : 'postgresql');
      const tier = options.tier ?? (tiers.length
        ? await select(
            'Tier',
            tiers.map((t) => ({ value: t.id, label: t.label, hint: [t.ram, t.price != null ? `$${t.price}/mo` : undefined, t.isSharedPool ? 'shared pool' : undefined].filter(Boolean).join(' · ') })),
            { flag: '--tier <tier>' }
          )
        : undefined);
      const tierEntry = tiers.find((t) => t.id === tier);
      const regionChoices = tierEntry?.isSharedPool && config?.database?.sharedPoolRegions?.length ? regions.filter((r) => config.database!.sharedPoolRegions!.includes(r.id)) : regions;
      const region = options.region ?? (regionChoices.length ? await select('Region', regionChoices.map((r) => ({ value: r.id, label: r.label })), { flag: '--region <region>' }) : undefined);

      const spin = spinner();
      spin.start(`Creating ${chosenName}`);
      const created = await ctx.api.createDatabase({
        targetOrganisationId: org.id,
        name: chosenName,
        databaseType: engine,
        tier,
        region,
        storageGb: options.storage ? Number(options.storage) : undefined,
        haEnabled: options.ha,
      });
      spin.stop(`Created ${c.bold(created.name)} ${c.dim(created.id)}`);

      let final: Database = created;
      if (options.watch) {
        const result = await watchResource(ctx.api, { kind: 'database', id: created.id, organisationId: org.id });
        if (!result.ok) {
          throw new CliError(result.update.deployment_error || 'Provisioning failed.', { hint: `Console: ${ctx.dbConsoleUrl(created)}`, exitCode: EXIT.FAILED });
        }
        final = await ctx.api.getDatabase(org.id, created.id);
      }
      emit(final, () => outro(options.watch ? `Connection details: ${c.bold(`lc db url ${final.name}`)}` : `Provisioning in the background; check with ${c.bold(`lc db get ${final.name}`)}.`));
    });

  db
    .command('tiers')
    .description('List database tiers, engines and regions')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const config = await ctx.api.platformConfig();
      const database = config.database ?? {};
      emit(database, () => {
        out(c.bold('Engines'));
        for (const t of database.types ?? []) out(`  ${t.id.padEnd(12)} ${t.label}${t.available ? '' : c.dim('  (unavailable)')}`);
        out();
        out(c.bold('Tiers'));
        for (const t of database.machineTypes ?? []) {
          out(`  ${t.id.padEnd(16)} ${String(t.label).padEnd(10)} ${c.dim([t.ram, t.vCPUs ? `${t.vCPUs} vCPU` : undefined, t.price != null ? `$${t.price}/mo` : undefined, t.isSharedPool ? 'shared pool' : undefined].filter(Boolean).join(' · '))}${t.available ? '' : c.dim('  (unavailable)')}`);
        }
        out();
        out(c.bold('Regions'));
        for (const r of database.regions ?? []) out(`  ${r.id.padEnd(20)} ${r.label}${r.available ? '' : c.dim('  (unavailable)')}`);
      });
    });

  db
    .command('delete <name>')
    .alias('rm')
    .description('Delete a database and all its data')
    .action(async (ref: string, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const database = await ctx.resolveDb(ref);
      const org = await ctx.resolveOrg();
      const ok = await confirm(`Delete ${c.bold(database.name)} and ALL its data? This cannot be undone.`, { yes: ctx.yes });
      if (!ok) return;
      await ctx.api.deleteDatabase(org.id, database.id);
      emit({ ok: true, id: database.id, name: database.name }, () => log.success(`Deleting ${c.bold(database.name)}.`));
    });

  db
    .command('url [name]')
    .alias('connection-string')
    .description('Print the connection string (secret!)')
    .option('--details', 'print host, port, user and password separately')
    .action(async (ref: string | undefined, options: { details?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const database = await ctx.resolveDb(ref);
      const org = await ctx.resolveOrg();
      const details = await ctx.api.connectionDetails(org.id, database.id);
      emit(details, () => {
        if (options.details) {
          printDetails([
            ['Host', details.host],
            ['Port', String(details.port)],
            ['Database', details.database],
            ['User', details.user],
            ['Password', details.password],
            ['SSL', details.sslMode ?? undefined],
          ]);
        } else {
          process.stdout.write(details.connectionString + '\n');
        }
      });
    });

  db
    .command('rotate-password [name]')
    .description('Generate a new admin password (apps using the old one must be updated)')
    .option('--password <value>', 'use this password instead of a generated one')
    .action(async (ref: string | undefined, options: { password?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const database = await ctx.resolveDb(ref);
      const org = await ctx.resolveOrg();
      const ok = await confirm(`Rotate the admin password of ${c.bold(database.name)}? Existing connections using the old password will break.`, { yes: ctx.yes });
      if (!ok) return;
      const result = await ctx.api.rotatePassword(org.id, database.id, options.password);
      emit(result, () => {
        log.success('Password rotated.');
        out(`  ${c.bold('New password')}  ${result.password}`);
        out(c.dim('  Update DATABASE_URL on every app that uses this database (lc env vars set …).'));
      });
    });

  db
    .command('dump [name]')
    .description('Download a compressed SQL dump')
    .option('-o, --output <file>', 'file to write (default: <name>-<date>.sql.gz)')
    .action(async (ref: string | undefined, options: { output?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const database = await ctx.resolveDb(ref);
      const org = await ctx.resolveOrg();
      const response = await ctx.api.dumpDatabase(org.id, database.id);
      const disposition = response.headers.get('content-disposition') ?? '';
      const suggested = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${database.slug || database.name}-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      const target = path.resolve(options.output ?? suggested);
      if (!response.body) throw new CliError('The API returned an empty dump.', { exitCode: EXIT.FAILED });

      const spin = spinner();
      spin.start(`Downloading dump of ${database.name}`);
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes % (5 * 1024 * 1024) < chunk.length) spin.message(`Downloading dump of ${database.name} ${c.dim(formatBytes(bytes))}`);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), counter, fs.createWriteStream(target));
      spin.stop(`Saved ${c.bold(target)} ${c.dim(`(${formatBytes(bytes)})`)}`);
      emit({ ok: true, file: target, bytes }, () => undefined);
    });
}

function printDb(db: Database, consoleUrl: string): void {
  heading(`${db.name}  ${statusBadge(db.status)}`);
  printDetails([
    ['Engine', `${db.database_type}${db.engine ? c.dim(`  ${db.engine}`) : ''}`],
    ['Tier', `${db.tier} ${c.dim(sym.bullet)} ${db.storage_gb} GB${db.ha_enabled ? ` ${c.dim(sym.bullet)} HA` : ''}`],
    ['Region', db.region],
    ['Host', db.connection_hostname || db.connection_host || undefined],
    ['Port', db.connection_port != null ? String(db.connection_port) : undefined],
    ['Database', db.database_name ?? undefined],
    ['User', db.admin_user ? maskSecret(db.admin_user) : undefined],
    ['Ready', relativeTime(db.ready_at)],
    ['Console', c.dim(consoleUrl)],
    ['ID', c.dim(db.id)],
  ]);
  if (db.status === 'failed' && db.deployment_error) {
    out();
    out(`  ${c.red(sym.fail)} ${db.deployment_error}`);
  }
  if (!isJson() && db.status === 'ready') {
    out();
    out(c.dim(`  lc db url ${db.name}  for the connection string`));
  }
}

export type { Context };
