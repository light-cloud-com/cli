import type { Command } from 'commander';
import type { DnsRecord, DomainResult } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, heading, log, out, printDetails, printTable, statusBadge } from '../lib/ui/output.js';
import { confirm } from '../lib/ui/prompts.js';
import { summariseDomain } from '../lib/domains/summary.js';
import { contextFrom } from './shared.js';

interface Scoped {
  app?: string;
  env?: string;
}

export function registerDomainCommands(program: Command): void {
  const domains = program.command('domains').alias('domain').description('Custom domains for an environment');

  domains
    .command('show', { isDefault: true })
    .description('Show the custom domain with a live DNS check')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const full = await ctx.api.getEnvironment(org.id, env.id);
      if (!full.custom_domain || full.is_custom_domain === false) {
        emit({ domain: null, url: full.deployed_url }, () => {
          heading(`${app.name} / ${env.name}`);
          log.info(`No custom domain. Add one with ${c.bold('lc domains add www.example.com')}.`);
        });
        return;
      }
      // Read DNS now: a stored check says what was true when someone last looked.
      const result = await ctx.api.checkDomain(org.id, env.id);
      emit(result, () => {
        heading(`${app.name} / ${env.name}`);
        printDomainResult(result, full.custom_domain!);
      });
    });

  domains
    .command('add <domain>')
    .description('Attach a custom domain (prints the DNS records to create)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .option('--force', 'replace a working domain even if the new one does not point here yet')
    .action(async (domain: string, options: Scoped & { force?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new CliError(`"${domain}" is not a domain name.`, { exitCode: EXIT.USAGE });
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.addDomain(org.id, env.id, clean, options.force === true);
      emit(result, () => printDomainResult(result, clean));
    });

  domains
    .command('check')
    .description('Re-check DNS for the custom domain')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.checkDomain(org.id, env.id);
      emit(result, () => printDomainResult(result, env.custom_domain ?? result.domain));
    });

  domains
    .command('retry')
    .description('Retry certificate issuance after fixing DNS')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.retryDomain(org.id, env.id);
      emit(result, () => printDomainResult(result, env.custom_domain ?? result.domain));
    });

  domains
    .command('remove')
    .alias('rm')
    .description('Detach the custom domain')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      if (!env.custom_domain) throw new CliError(`${app.name} / ${env.name} has no custom domain.`, { exitCode: EXIT.NOT_FOUND });
      const ok = await confirm(`Remove ${c.bold(env.custom_domain)} from ${app.name} / ${env.name}?`, { yes: ctx.yes });
      if (!ok) return;
      const result = await ctx.api.removeDomain(org.id, env.id);
      emit({ ok: true, ...result }, () => log.success(`Removed ${c.bold(env.custom_domain!)}. The app stays reachable at its light-cloud.io address.`));
    });
}

function printDomainResult(result: DomainResult, domain: string): void {
  const summary = summariseDomain(result, domain);

  if (summary.state === 'serving') log.success(`${c.bold(domain)} is active and serving over HTTPS.`);
  else if (summary.state === 'unreachable')
    log.warn(`${c.bold(domain)} has a certificate, but its DNS does not point here. Visitors cannot reach it.`);
  else if (summary.state === 'failed')
    log.error(`${c.bold(domain)} could not be verified. Fix the records below, then run ${c.bold('lc domains retry')}.`);
  else log.info(`${c.bold(domain)}  ${statusBadge('pending')}  waiting for DNS`);

  if (summary.hostnames.length > 1) {
    out();
    printTable(summary.hostnames, [
      { header: 'Address', cell: (h) => c.bold(h.hostname) },
      { header: 'Role', cell: (h) => (h.optional ? `${h.role} (optional)` : h.role) },
      { header: 'Status', cell: (h) => statusBadge(h.status === 'pending_verification' ? 'pending' : h.status) },
    ]);
  }

  // The server's sentences name the record and what DNS says now.
  if (summary.state !== 'serving') for (const issue of result.issues ?? []) log.warn(`  ${issue}`);

  if (result.removeRecords?.length) {
    out();
    out('  Delete at your DNS provider (they send the domain somewhere else):');
    printTable(result.removeRecords, [
      { header: 'Type', cell: (r) => c.bold(r.type) },
      { header: 'Name', cell: (r) => r.host },
      { header: 'Current value', cell: (r) => r.value, maxWidth: 80 },
    ]);
    out(c.dim('  Not in your DNS list? Turn off "forwarding" or "parking" for the domain.'));
  }

  if (summary.required.length) {
    out();
    out(summary.state === 'serving' ? '  Keep at your DNS provider:' : '  Add at your DNS provider:');
    printDns(summary.required, summary.hostnames.length > 1);
  }
  if (summary.optional.length && summary.state !== 'serving') {
    out();
    out(c.dim('  Optional, only to switch a domain that already has visitors without downtime:'));
    printDns(summary.optional, summary.hostnames.length > 1);
  }

  const rootInvolved = summary.hostnames.some((h) => h.role !== 'main address' || h.hostname.split('.').length === 2);
  if (result.dnsProvider?.note && rootInvolved && summary.state !== 'serving') {
    out();
    out(`  ${c.dim(result.dnsProvider.note)}`);
  }
  if (summary.state === 'waiting' || summary.state === 'unreachable') {
    out();
    out(c.dim('  DNS changes usually show within minutes. Then run `lc domains check`.'));
  }
}

function printDns(records: DnsRecord[], showAddress = false): void {
  const checked = records.some((r) => r.check);
  printTable(records, [
    ...(showAddress ? [{ header: 'For', cell: (r: DnsRecord) => r.hostname ?? '' }] : []),
    { header: 'Type', cell: (r: DnsRecord) => c.bold(r.type === 'ALIAS' ? 'ALIAS / ANAME' : r.type) },
    { header: 'Name', cell: (r: DnsRecord) => r.host ?? r.name },
    { header: 'Value', cell: (r: DnsRecord) => r.value, maxWidth: 80 },
    ...(checked
      ? [
          {
            header: 'In your DNS',
            cell: (r: DnsRecord) =>
              !r.check
                ? ''
                : r.check.ok
                  ? c.green('found')
                  : r.check.observed
                    ? `different: ${r.check.observed}`
                    : 'not found',
            maxWidth: 60,
          },
        ]
      : []),
  ]);
}
