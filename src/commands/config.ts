import type { Command } from 'commander';
import { credentialsPath, resolveAuth } from '../lib/auth/credentials.js';
import { globalConfigPath, readGlobalConfig, resolveEndpoints, updateGlobalConfig, writeGlobalConfig } from '../lib/config/global-config.js';
import { deleteProjectConfig, findProjectConfig } from '../lib/config/project-config.js';
import { CliError, EXIT } from '../lib/errors.js';
import { c, emit, log, printDetails } from '../lib/ui/output.js';

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('CLI settings (API endpoint, defaults)');

  config
    .command('show', { isDefault: true })
    .description('Show effective settings and where they come from')
    .action(async () => {
      const stored = readGlobalConfig();
      const endpoints = resolveEndpoints();
      const auth = resolveAuth();
      const project = findProjectConfig();
      emit(
        { endpoints, auth: auth.source, config: stored, configPath: globalConfigPath(), project: project?.config ?? null, projectPath: project?.path ?? null },
        () => {
          printDetails([
            ['API URL', `${endpoints.apiUrl}${process.env.LIGHT_CLOUD_API_URL ? c.dim('  (LIGHT_CLOUD_API_URL)') : stored.apiUrl ? c.dim('  (config)') : c.dim('  (default)')}`],
            ['Console URL', endpoints.consoleUrl],
            ['Credentials', `${auth.source === 'none' ? c.yellow('none') : auth.source} ${c.dim(credentialsPath())}`],
            ['Default workspace', stored.defaultOrganisationName ? `${stored.defaultOrganisationName} ${c.dim(stored.defaultOrganisationId ?? '')}` : c.dim('not set')],
            ['Settings file', c.dim(globalConfigPath())],
            ['Linked app', project ? `${project.config.applicationName ?? project.config.applicationId ?? '?'} ${c.dim(project.path)}` : c.dim('none in this folder')],
          ]);
        }
      );
    });

  config
    .command('set <key> <value>')
    .description('Set a value: api-url, console-url')
    .action(async (key: string, value: string) => {
      const normalised = key.toLowerCase().replace(/_/g, '-');
      if (normalised === 'api-url' || normalised === 'apiurl') {
        assertUrl(value);
        updateGlobalConfig({ apiUrl: value.replace(/\/+$/, '') });
      } else if (normalised === 'console-url' || normalised === 'consoleurl') {
        assertUrl(value);
        updateGlobalConfig({ consoleUrl: value.replace(/\/+$/, '') });
      } else {
        throw new CliError(`Unknown setting "${key}".`, { hint: 'Settings: api-url, console-url.', exitCode: EXIT.USAGE });
      }
      emit({ ok: true, key: normalised, value }, () => log.success(`${normalised} = ${value}`));
    });

  config
    .command('unset <key>')
    .description('Remove a setting and fall back to the default')
    .action(async (key: string) => {
      const stored = readGlobalConfig();
      const normalised = key.toLowerCase().replace(/_/g, '-');
      if (normalised === 'api-url') delete stored.apiUrl;
      else if (normalised === 'console-url') delete stored.consoleUrl;
      else if (normalised === 'default-org' || normalised === 'org') {
        delete stored.defaultOrganisationId;
        delete stored.defaultOrganisationName;
      } else throw new CliError(`Unknown setting "${key}".`, { hint: 'Settings: api-url, console-url, default-org.', exitCode: EXIT.USAGE });
      writeGlobalConfig(stored);
      emit({ ok: true, key: normalised }, () => log.success(`${normalised} cleared.`));
    });

  program
    .command('unlink')
    .description('Remove the .lightcloud link file from this folder')
    .action(async () => {
      const project = findProjectConfig();
      if (!project) {
        emit({ ok: true, removed: false }, () => log.info('This folder is not linked to an app.'));
        return;
      }
      deleteProjectConfig(project.directory);
      emit({ ok: true, removed: true, path: project.path }, () => log.success(`Removed ${c.dim(project.path)}. The app itself is untouched.`));
    });
}

function assertUrl(value: string): void {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new CliError(`"${value}" is not an http(s) URL.`, { exitCode: EXIT.USAGE });
  }
}
