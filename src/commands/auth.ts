import type { Command } from 'commander';
import { SIGN_IN_CANCELLED, startLoginFlow } from '../lib/auth/browser-login.js';
import { DEVICE_SIGN_IN_DENIED, startDeviceFlow } from '../lib/auth/device-login.js';
import { clearCredentials, credentialsPath, isApiKey, readCredentials, resolveAuth, updateCredentials, writeCredentials } from '../lib/auth/credentials.js';
import { readGlobalConfig, updateGlobalConfig } from '../lib/config/global-config.js';
import { ApiError, CancelledError, CliError, EXIT } from '../lib/errors.js';
import { openBrowser } from '../lib/open-browser.js';
import { brand, c, emit, isInteractive, isJson, link, log, out, printDetails, printTable } from '../lib/ui/output.js';
import { intro, logStep, outro, select, spinner, text } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

async function browserSignIn(consoleUrl: string, openIt: boolean) {
  const flow = await startLoginFlow(consoleUrl);

  const opened = openIt && isInteractive() ? openBrowser(flow.url) : false;
  if (opened) {
    out(`${c.dim('│')}  Browser opened. If nothing happened, open this link:`);
  } else {
    out(`${c.dim('│')}  Open this link in your browser to sign in:`);
  }
  out(`${c.dim('│')}  ${link(flow.url)}`);
  // With --json, `out` is silent until the final document — but the link is
  // needed *now*, so it also goes to stderr where an agent or script sees it.
  if (isJson()) process.stderr.write(`Open this link to sign in: ${flow.url}\n`);

  const spin = spinner();
  spin.start('Waiting for you to sign in…');
  try {
    const tokens = await flow.tokens;
    spin.stop('Signed in');
    return tokens;
  } catch (error) {
    // Cancel in the browser is a choice, not a failure: stop the wait
    // quietly and leave the exit code to say what happened.
    if (error instanceof CliError && error.code === SIGN_IN_CANCELLED) {
      spin.stop('Sign-in cancelled in the browser', 2);
      throw new CancelledError();
    }
    spin.stop('Sign-in did not complete', 1);
    throw error;
  }
}

/**
 * The code flow: an email, a code shown here, approval in any browser. A
 * new address gets an account on approval, so this doubles as sign-up.
 */
async function deviceSignIn(client: import('../lib/api/client.js').ApiClient, emailFlag?: string) {
  const email =
    emailFlag?.trim().toLowerCase() ||
    (await text('Email address', {
      flag: '--email <address>',
      placeholder: 'you@example.com',
      validate: (value) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? undefined : 'Enter an email address'),
    })).trim().toLowerCase();

  const flow = await startDeviceFlow(client, email);
  const minutes = Math.max(1, Math.round((flow.expiresAt - Date.now()) / 60000));

  if (flow.newAccount) {
    out(`${c.dim('│')}  No account exists for ${c.bold(email)} yet — approving creates one (free plan).`);
    out(`${c.dim('│')}  Open the link in the email we sent to ${email}, then enter the code:`);
  } else {
    out(`${c.dim('│')}  Open ${link(flow.verificationUrl)} on any device, sign in, and enter the code:`);
  }
  out(`${c.dim('│')}`);
  out(`${c.dim('│')}      ${c.bold(flow.userCode)}`);
  out(`${c.dim('│')}`);
  out(`${c.dim('│')}  ${c.dim(`The code expires in ${minutes} minutes.`)}`);
  if (isJson()) process.stderr.write(`Enter code ${flow.userCode} at ${flow.verificationUrl} (expires in ${minutes} min)\n`);
  if (!flow.emailSent) {
    log.warn('The confirmation email could not be sent; an existing account can still approve by signing in on the page above.');
  }

  const spin = spinner();
  spin.start('Waiting for the code to be approved…');
  try {
    const tokens = await flow.tokens;
    spin.stop(flow.newAccount ? 'Account created and signed in' : 'Signed in');
    return tokens;
  } catch (error) {
    if (error instanceof CliError && error.code === DEVICE_SIGN_IN_DENIED) {
      spin.stop('Sign-in refused in the browser', 2);
      throw new CancelledError();
    }
    spin.stop('Sign-in did not complete', 1);
    throw error;
  }
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Sign in to Light Cloud (opens your browser, or a code to type on another device)')
    .option('--api-key <key>', 'sign in with an API key instead of a browser session')
    .option('--no-browser', 'print the sign-in URL instead of opening a browser')
    .option('--device', 'sign in with a short code from any device (no browser needed here); creates the account if the email has none')
    .option('--email <address>', 'email for --device sign-in')
    .action(async (options: { apiKey?: string; browser: boolean; device?: boolean; email?: string }, command: Command) => {
      const ctx = contextFrom(command);

      if (options.apiKey) {
        if (!isApiKey(options.apiKey)) {
          throw new CliError('That does not look like a Light Cloud API key.', {
            hint: 'Keys start with `lc_`. Create one in the console under Organisation settings → API keys.',
            exitCode: EXIT.USAGE,
          });
        }
        writeCredentials({ ...readCredentials(), apiKey: options.apiKey, accessToken: undefined, refreshToken: undefined });
        // Prove the key works before claiming success.
        try {
          await ctx.api.listApplications('api-key', undefined, 1);
        } catch (error) {
          clearCredentials();
          throw error;
        }
        emit({ ok: true, method: 'api-key' }, () => log.success(`API key saved to ${c.dim(credentialsPath())}.`));
        return;
      }

      if (process.env.LIGHT_CLOUD_API_KEY) {
        log.warn('LIGHT_CLOUD_API_KEY is set in this shell and takes precedence over a browser session.');
      }

      if (ctx.api.client.hasCredentials() && !ctx.usingApiKey) {
        try {
          const profile = await ctx.api.profile();
          emit({ ok: true, alreadySignedIn: true, email: profile.email }, () => {
            log.info(`Already signed in as ${c.bold(profile.email)}. Run \`lc logout\` first to switch accounts.`);
          });
          return;
        } catch {
          // stale session: fall through to a fresh sign-in
        }
      }

      intro(`${brand()} sign-in`);
      // No display and no --device: the loopback callback can never arrive,
      // so the code flow is the only one that can work.
      const useDevice = options.device || Boolean(options.email) || (!process.env.DISPLAY && process.platform === 'linux' && !options.browser);
      const tokens = useDevice ? await deviceSignIn(ctx.api.client, options.email) : await browserSignIn(ctx.endpoints.consoleUrl, options.browser);
      // A browser session replaces any stored key; the two must not coexist
      // or `whoami` and `deploy` would answer for different principals.
      writeCredentials({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });

      const profile = await ctx.api.profile();
      const orgs = profile.organisations ?? [];
      logStep(`Signed in as ${c.bold(profile.email)}`);

      // Settle the default workspace now rather than leaving it to a later
      // command: one workspace picks itself, several are asked about while
      // the person is already here.
      const saved = readGlobalConfig().defaultOrganisationId;
      let defaultOrg = orgs.find((org) => org.id === saved);
      if (!defaultOrg && orgs.length === 1) defaultOrg = orgs[0];
      if (!defaultOrg && orgs.length > 1 && isInteractive()) {
        const chosen = await select<string>(
          'Which workspace should lc use by default?',
          orgs.map((org) => ({ value: org.id, label: org.name, hint: org.role })),
          { flag: 'lc org use <name>' }
        );
        defaultOrg = orgs.find((org) => org.id === chosen);
      }
      if (defaultOrg) {
        updateGlobalConfig({ defaultOrganisationId: defaultOrg.id, defaultOrganisationName: defaultOrg.name });
      }

      emit({ ok: true, method: useDevice ? 'device' : 'browser', email: profile.email, organisations: orgs, defaultOrganisationId: defaultOrg?.id ?? null }, () => {
        if (orgs.length > 1) {
          logStep(`Workspaces${defaultOrg ? c.dim(`  (default: ${defaultOrg.name}; change with lc org use <name>)`) : ''}`);
          for (const org of orgs) {
            const marker = org.id === defaultOrg?.id ? c.accent(' ✔ default') : '';
            out(`${c.dim('│')}  ${c.dim('·')} ${org.name} ${c.dim(`(${org.role})`)}${marker}`);
          }
        } else if (defaultOrg) {
          logStep(`Workspace ${c.bold(defaultOrg.name)} ${c.dim(`(${defaultOrg.role})`)}`);
        }
        if (!defaultOrg && orgs.length > 1) {
          out(`${c.dim('│')}  Pick one with: ${orgs.map((org) => c.bold(`lc org use ${quoteArg(org.name)}`)).join(c.dim('  or  '))}`);
        }
        outro(`Ready. Try ${c.bold('lc apps')} or ${c.bold('lc init')} in a project folder.`);
      });
    });

  program
    .command('logout')
    .description('Sign out and forget stored credentials')
    .action(async () => {
      const had = readCredentials();
      clearCredentials();
      emit({ ok: true }, () => {
        if (had.accessToken || had.apiKey) log.success('Signed out. Credentials removed.');
        else log.info('You were not signed in.');
      });
    });

  program
    .command('whoami')
    .description('Show the signed-in account and its workspaces')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const auth = resolveAuth();
      if (!auth.token) {
        throw new CliError('Not signed in.', { hint: 'Run `lc login`.', exitCode: EXIT.AUTH });
      }

      if (isApiKey(auth.token)) {
        const org = await ctx.resolveOrg();
        emit({ method: auth.source, organisationId: org.id, apiUrl: ctx.endpoints.apiUrl }, () => {
          printDetails([
            ['Signed in with', `API key ${c.dim(`(${auth.source === 'env-api-key' ? 'LIGHT_CLOUD_API_KEY' : credentialsPath()})`)}`],
            ['Workspace', org.id],
            ['API', ctx.endpoints.apiUrl],
          ]);
        });
        return;
      }

      let profile;
      try {
        profile = await ctx.api.profile();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw new CliError('Your session has expired.', { hint: 'Run `lc login` to sign in again.', exitCode: EXIT.AUTH });
        }
        throw error;
      }
      const defaultOrg = readGlobalConfig().defaultOrganisationId;
      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');

      emit({ ...profile, defaultOrganisationId: defaultOrg, apiUrl: ctx.endpoints.apiUrl }, () => {
        printDetails([
          ['Account', `${c.bold(profile.email)}${name ? c.dim(`  ${name}`) : ''}`],
          ['API', ctx.endpoints.apiUrl],
          ['Linked app', ctx.project ? `${ctx.project.config.applicationName ?? ctx.project.config.applicationId} ${c.dim(ctx.project.path)}` : undefined],
        ]);
        out();
        printTable(profile.organisations ?? [], [
          { header: 'Workspace', cell: (org) => `${org.name}${org.id === defaultOrg ? c.accent(' (default)') : ''}` },
          { header: 'Role', cell: (org) => org.role },
          { header: 'ID', cell: (org) => c.dim(org.id) },
        ]);
      });
    });
}

/** Shell-safe form of a workspace name for a copy-pasteable command. */
function quoteArg(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export { updateCredentials };
