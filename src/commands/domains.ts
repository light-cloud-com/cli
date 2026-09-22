import type { Command } from 'commander';
import type { DnsRecord, DomainResult } from '../lib/api/types.js';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, heading, log, out, printDetails, printTable, statusBadge } from '../lib/ui/output.js';
import { confirm } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

interface Scoped {
  app?: string;
  env?: string;
}

export function registerDomainCommands(program: Command): void {
  const domains = program.command('domains').alias('domain').description('Custom domains for an environment');

  domains
    .command('show', { isDefault: true })
    .description('Show the custom domain and its DNS status')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const full = await ctx.api.getEnvironment(org.id, env.id);
      emit({ domain: full.custom_domain, status: full.custom_domain_status, dns: full.custom_domain_dns, url: full.deployed_url }, () => {
        heading(`${app.name} / ${env.name}`);
        if (!full.custom_domain) {
          log.info(`No custom domain. Add one with ${c.bold('lc domains add example.com')}.`);
          return;
        }
        printDetails([
          ['Domain', `${c.bold(full.custom_domain)}  ${statusBadge(full.custom_domain_status ?? 'unknown')}`],
          ['Serves', full.deployed_url ?? undefined],
        ]);
        if (full.custom_domain_dns?.length) {
          out();
          printDns(full.custom_domain_dns);
        }
      });
    });

  domains
    .command('add <domain>')
    .description('Attach a custom domain (prints the DNS records to create)')
    .option('-a, --app <app>', 'app name or id')
    .option('-e, --env <env>', 'environment (default: production)')
    .action(async (domain: string, options: Scoped, command: Command) => {
      const ctx = contextFrom(command);
      const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new CliError(`"${domain}" is not a domain name.`, { exitCode: EXIT.USAGE });
      const app = await ctx.resolveApp(options.app);
      const env = await ctx.resolveEnv(app, options.env);
      const org = await ctx.resolveOrg();
      const result = await ctx.api.addDomain(org.id, env.id, clean);
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
  const status = result.status ?? 'unknown';
  if (status === 'active') log.success(`${c.bold(domain)} is active.`);
  else log.info(`${c.bold(domain)}  ${statusBadge(status)}`);
  if (result.message && status !== 'active') out(`  ${c.dim(result.message)}`);
  for (const issue of result.issues ?? []) log.warn(`  ${issue}`);
  if (result.dnsRecords?.length) {
    out();
    printDns(result.dnsRecords);
    out();
    out(c.dim('  Create these records at your DNS provider, then run `lc domains check`.'));
  }
}

function printDns(records: DnsRecord[]): void {
  printTable(records, [
    { header: 'Type', cell: (r) => c.bold(r.type) },
    { header: 'Name', cell: (r) => r.name },
    { header: 'Value', cell: (r) => r.value, maxWidth: 80 },
  ]);
}
