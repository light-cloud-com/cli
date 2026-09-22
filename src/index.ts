/**
 * `lc` — the Light Cloud command line.
 */

import { Command, CommanderError } from 'commander';
import { registerAppCommands } from './commands/apps.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerBillingCommands } from './commands/billing.js';
import { registerConfigCommands } from './commands/config.js';
import { registerParityCommands } from './commands/parity.js';
import { registerDbCommands } from './commands/dbs.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerDeploymentCommands } from './commands/deployments.js';
import { registerDomainCommands } from './commands/domains.js';
import { registerEnvCommands } from './commands/envs.js';
import { registerInitCommands } from './commands/init.js';
import { registerLogsCommand } from './commands/logs.js';
import { registerOrgCommands } from './commands/orgs.js';
import { ApiError, CancelledError, CliError, EXIT } from './lib/errors.js';
import { c, configureOutput, err, isJson, printJson } from './lib/ui/output.js';
import { cliVersion } from './lib/version.js';

const program = new Command();

program
  .name('lc')
  .description(`${c.bold('Light Cloud')} from the terminal: deploy, watch, inspect.`)
  .version(cliVersion(), '-v, --version', 'print the CLI version')
  .option('--json', 'machine-readable output (one JSON document on stdout)')
  .option('-o, --org <workspace>', 'workspace name or id')
  .option('-y, --yes', 'answer yes to confirmations')
  .option('--api-url <url>', 'Light Cloud API endpoint (or LIGHT_CLOUD_API_URL)')
  .option('--no-color', 'disable colours')
  .showHelpAfterError('(add --help for usage)')
  .showSuggestionAfterError(true)
  .configureHelp({ sortSubcommands: false, subcommandTerm: (cmd) => cmd.name() + (cmd.alias() ? `|${cmd.alias()}` : '') })
  .addHelpText(
    'after',
    `
${c.bold('Getting started')}
  $ lc login                  sign in (opens the browser)
  $ lc init                   link this folder to an app, or create one
  $ lc deploy                 deploy and follow the build
  $ lc logs -f                tail runtime logs

${c.bold('Everyday')}
  $ lc apps                   what is deployed
  $ lc status my-app          environments, URLs, last deploy
  $ lc env vars set KEY=v --redeploy
  $ lc rollback               go back to a previous deployment
  $ lc db url my-db           connection string

${c.dim('CI: set LIGHT_CLOUD_API_KEY and run from a folder with a .lightcloud file.')}
${c.dim('Docs: https://docs.light-cloud.com/cli')}`
  );

program.hook('preAction', (thisCommand) => {
  const options = thisCommand.optsWithGlobals() as { json?: boolean; color?: boolean };
  const noColor = options.color === false || Boolean(process.env.NO_COLOR);
  configureOutput(noColor ? { json: Boolean(options.json), color: false } : { json: Boolean(options.json) });
});

registerAuthCommands(program);
registerOrgCommands(program);
registerInitCommands(program);
registerAppCommands(program);
registerDeployCommand(program);
registerEnvCommands(program);
registerLogsCommand(program);
registerDeploymentCommands(program);
registerDomainCommands(program);
registerDbCommands(program);
registerBillingCommands(program);
registerConfigCommands(program);
registerParityCommands(program);

program.exitOverride();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    handleError(error);
  }
}

function handleError(error: unknown): never {
  if (error instanceof CommanderError) {
    // commander already printed help / version / usage error
    process.exit(error.exitCode);
  }
  if (error instanceof CancelledError) {
    if (!isJson()) err(c.dim('Cancelled.'));
    process.exit(EXIT.CANCELLED);
  }
  if (error instanceof CliError) {
    if (isJson()) {
      printJson({ error: { code: error.code, message: error.message, hint: error.hint, status: error instanceof ApiError ? error.status : undefined } });
    } else {
      err(`${c.red('✖')} ${error.message}`);
      if (error.hint) err(`  ${c.dim(error.hint)}`);
    }
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isJson()) printJson({ error: { code: 'UNEXPECTED', message } });
  else {
    err(`${c.red('✖')} ${message}`);
    if (process.env.LC_DEBUG && error instanceof Error && error.stack) err(c.dim(error.stack));
    else err(c.dim('  Set LC_DEBUG=1 for a stack trace.'));
  }
  process.exit(EXIT.ERROR);
}

void main();
