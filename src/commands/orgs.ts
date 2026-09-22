import type { Command } from 'commander';
import { readGlobalConfig, updateGlobalConfig } from '../lib/config/global-config.js';
import { findOrg } from '../lib/context.js';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, log, out, printTable } from '../lib/ui/output.js';
import { select } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

export function registerOrgCommands(program: Command): void {
  program
    .command('orgs')
    .alias('workspaces')
    .description('List the workspaces you belong to')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const profile = await ctx.profile();
      const defaultOrg = readGlobalConfig().defaultOrganisationId;
      const orgs = profile.organisations ?? [];
      emit(orgs, () => {
        printTable(orgs, [
          { header: 'Workspace', cell: (org) => `${c.bold(org.name)}${org.id === defaultOrg ? c.accent(' (default)') : ''}` },
          { header: 'Role', cell: (org) => org.role },
          { header: 'ID', cell: (org) => c.dim(org.id) },
        ]);
        if (orgs.length > 1) {
          out();
          out(c.dim('  Switch default: lc org use <name>   ·   one command only: lc <command> --org <name>'));
        }
      });
    });

  const org = program.command('org').description('Workspace settings');

  org
    .command('use [workspace]')
    .alias('switch')
    .description('Set the default workspace (no name: pick from a list)')
    .action(async (ref: string | undefined, _options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const profile = await ctx.profile();
      const orgs = profile.organisations ?? [];
      const current = readGlobalConfig().defaultOrganisationId;

      let match = ref ? findOrg(orgs, ref) : undefined;
      if (ref && !match) {
        throw new CliError(`No workspace called "${ref}".`, {
          hint: `Your workspaces: ${orgs.map((org) => org.name).join(', ')}.`,
          exitCode: EXIT.NOT_FOUND,
        });
      }
      if (!match) {
        if (orgs.length === 0) throw new CliError('This account has no workspaces yet.', { exitCode: EXIT.NOT_FOUND });
        const chosen = await select<string>(
          'Which workspace should lc use by default?',
          orgs.map((org) => ({ value: org.id, label: org.name, hint: org.id === current ? `${org.role} · current default` : org.role })),
          { flag: 'lc org use <name>', initialValue: current ?? undefined }
        );
        match = orgs.find((org) => org.id === chosen)!;
      }

      updateGlobalConfig({ defaultOrganisationId: match.id, defaultOrganisationName: match.name });
      emit({ ok: true, organisation: match }, () => {
        log.success(`Default workspace is now ${c.bold(match!.name)}.`);
        const others = orgs.filter((org) => org.id !== match!.id);
        if (others.length) log.info(c.dim(`One-off: add --org <name> to any command. Others: ${others.map((org) => org.name).join(', ')}.`));
      });
    });

  org
    .command('current')
    .description('Show which workspace commands will use here')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const current = await ctx.resolveOrg({ interactive: false });
      emit(current, () => {
        const via = ctx.project?.config.organisationId === current.id ? 'linked folder' : readGlobalConfig().defaultOrganisationId === current.id ? 'default' : 'only workspace';
        log.info(`${c.bold(current.name ?? current.id)} ${c.dim(`(${via})`)}`);
      });
    });
}
