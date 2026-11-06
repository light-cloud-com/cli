/**
 * `lc templates`: search the gallery, inspect one template, deploy it.
 * `lc stack create` and `lc init --template` reuse the deploy and download
 * halves below.
 */

import type { Command } from 'commander';
import type { LightCloudApi } from '../lib/api/light-cloud.js';
import type { TemplateDeployRequest, TemplateDeployStatus, TemplateSearch } from '../lib/api/types.js';
import type { Context } from '../lib/context.js';
import { ApiError, CliError, EXIT } from '../lib/errors.js';
import { watchResource } from '../lib/realtime/watch.js';
import { brand, c, emit, link, log, out, printDetails, printTable } from '../lib/ui/output.js';
import { intro, outro, spinner, text } from '../lib/ui/prompts.js';
import { assertEmptyFolder, unpackTemplate } from '../lib/upload/unpack.js';
import { parsePairs } from './envs.js';
import { contextFrom } from './shared.js';

const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  creating_database: 'Creating the database',
  creating_app: 'Creating the app',
  deploying: 'Deploying',
};

export function registerTemplateCommands(program: Command): void {
  const templates = program.command('templates').description('Start from a template: search the gallery, inspect one, deploy it');

  templates
    .command('search [query]')
    .description('Search the template gallery')
    .option('--category <id>', 'kind or category, e.g. websites, portfolio, fullstack')
    .option('--runs <list>', 'static, server, database (comma-separated)')
    .option('--language <list>', 'languages, e.g. JavaScript,Python')
    .option('--framework <list>', 'framework ids, e.g. nextjs,astro')
    .option('--price <list>', 'free, premium')
    .option('--page <n>', 'page number')
    .action(async (query: string | undefined, options: TemplateSearch, command: Command) => {
      const list = await contextFrom(command).api.searchTemplates({ ...options, query });
      emit(list, () => {
        if (list.items.length === 0) return log.info('No templates match.');
        printTable(list.items, [
          { header: 'Template', cell: (t) => c.bold(t.slug) },
          { header: 'Name', cell: (t) => t.name, maxWidth: 32 },
          { header: 'Runs as', cell: (t) => t.runsAs },
          { header: 'Framework', cell: (t) => t.frameworkName },
          { header: 'Deploys', cell: (t) => String(t.deployCount), align: 'right' },
        ]);
        const pages = Math.ceil(list.total / Math.max(list.perPage, 1));
        out(c.dim(`${list.total} ${list.total === 1 ? 'template' : 'templates'}${pages > 1 ? `, page ${list.page} of ${pages}` : ''}. Details: lc templates show <template>`));
      });
    });

  templates
    .command('show <slug>')
    .description('What a template creates, the plan it needs and its variables')
    .action(async (slug: string, _options: unknown, command: Command) => {
      const detail = await contextFrom(command).api.template(slug);
      const { template } = detail;
      emit(detail, () => {
        out(`${c.bold(template.name)}  ${c.dim(template.description)}`);
        const database = template.creates.database ? ` and a ${template.creates.database.engine} database` : '';
        printDetails([
          ['Creates', `${template.creates.app === 'static' ? 'a static site' : 'a server app'}${database}`],
          ['Framework', template.frameworkName],
          ['Plan', template.planRequired === 'free' ? 'Free' : 'a paid plan'],
          ['Code', template.repo.url],
          ['Demo', template.demoUrl],
          ['Deploys', String(template.deployCount)],
        ]);
        if (template.variables.length) {
          out();
          printTable(template.variables, [
            { header: 'Variable', cell: (v) => v.name },
            { header: 'Value', cell: (v) => v.kind },
            { header: '', cell: (v) => c.dim(v.hint ?? ''), maxWidth: 60 },
          ]);
        }
        out();
        // A database template cannot start from an upload, so it has no local route.
        const local = template.creates.database ? '' : ` Edit it first: lc init --template ${template.slug}`;
        out(c.dim(`Deploy it: lc templates deploy ${template.slug} --name <name>.${local}`));
      });
    });

  templates
    .command('deploy <slug>')
    .description('Deploy a template as a new app and follow it until it is live')
    .requiredOption('-n, --name <name>', 'app name')
    .option('--copy <mode>', 'repo (copy into your connected git provider) or readonly; default repo when one is connected')
    .option('--env <pairs...>', 'variables KEY=value')
    .option('--region <region>', 'region')
    .option('--folder <id>', 'folder id')
    .action(async (slug: string, options: { name: string; copy?: string; env?: string[]; region?: string; folder?: string }, command: Command) => {
      if (options.copy !== undefined && options.copy !== 'repo' && options.copy !== 'readonly') {
        throw new CliError('--copy must be repo or readonly.', { exitCode: EXIT.USAGE });
      }
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      intro(`${brand()} templates deploy`);
      const started = await startTemplateDeploy(ctx.api, slug, {
        organisationId: org.id,
        name: options.name,
        copy: options.copy,
        region: options.region,
        folderId: options.folder,
        environmentVars: parsePairs(options.env ?? []),
      });
      await followTemplateDeploy(ctx, org.id, started.templateDeployId);
    });
}

/**
 * Start a template deploy. Without a copy mode it copies into the
 * workspace's connected git provider when there is one (the deploy plan
 * lists them), else deploys read-only from the template's repository.
 */
export async function startTemplateDeploy(
  api: LightCloudApi,
  slug: string,
  request: Omit<TemplateDeployRequest, 'copy' | 'via'> & { copy?: TemplateDeployRequest['copy'] }
): Promise<{ templateDeployId: string; applicationId: string | null }> {
  let { copy, provider } = request;
  if (copy !== 'readonly' && !provider) {
    const plan = await api.templateDeployPlan(slug, request.organisationId);
    // Templates switched off: the plan answers 200 with this blocker.
    const flagOff = plan.blockers?.find((blocker) => blocker.code === 'FLAG_OFF');
    if (flagOff) throw new ApiError(409, 'FLAG_OFF', flagOff.message);
    provider = plan.copyOptions?.providers?.[0];
    copy ??= provider ? 'repo' : 'readonly';
  }
  return api.deployTemplate(slug, { ...request, copy: copy ?? 'repo', provider, via: 'cli' });
}

/** Poll a template deploy until it has an application, fails or goes live. */
export async function waitForTemplateApp(
  api: Pick<LightCloudApi, 'templateDeploy'>,
  templateDeployId: string,
  options: { onStatus?: (status: TemplateDeployStatus['status']) => void; intervalMs?: number; timeoutMs?: number } = {}
): Promise<TemplateDeployStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
  for (;;) {
    const deploy = await api.templateDeploy(templateDeployId);
    options.onStatus?.(deploy.status);
    if (deploy.applicationId || deploy.status === 'failed' || deploy.status === 'live') return deploy;
    if (Date.now() >= deadline) {
      throw new CliError('The template is taking longer than usual to set up.', {
        hint: 'It carries on in the background; see it with `lc apps` in a few minutes.',
        exitCode: EXIT.FAILED,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 3000));
  }
}

/** After a template deploy starts: its setup steps, then the first deployment, then the live URL. */
export async function followTemplateDeploy(ctx: Context, organisationId: string, templateDeployId: string): Promise<void> {
  const spin = spinner();
  spin.start('Setting up');
  const deploy = await waitForTemplateApp(ctx.api, templateDeployId, { onStatus: (status) => spin.message(STEP_LABELS[status] ?? status) });
  if (deploy.status === 'failed' || !deploy.applicationId) {
    spin.stop('Setup failed', 1);
    throw new CliError(deploy.error || 'The template could not be set up.', { exitCode: EXIT.FAILED, code: 'DEPLOY_FAILED' });
  }
  spin.stop(`Created ${c.bold(deploy.template.name)} ${c.dim(deploy.applicationId)}`);

  const watched = await watchResource(
    ctx.api,
    deploy.environmentId
      ? { kind: 'environment', id: deploy.environmentId, organisationId }
      : { kind: 'application', id: deploy.applicationId, organisationId }
  );
  if (!watched.ok) {
    throw new CliError(watched.update.deployment_error || 'The first deployment failed.', {
      hint: `See the build log in the console: ${ctx.appConsoleUrl({ id: deploy.applicationId })}`,
      exitCode: EXIT.FAILED,
      code: 'DEPLOY_FAILED',
    });
  }
  const url = watched.update.deployed_url || deploy.url || undefined;
  emit(
    { ok: true, templateDeployId, template: deploy.template, application: { id: deploy.applicationId }, environmentId: deploy.environmentId, url },
    () => outro(url ? `Live at ${link(url)}` : 'Done.')
  );
}

/**
 * `lc init --template`: check the template can start from an upload, ask for
 * the required variables not given with --var, then copy its code into a new
 * or empty folder. Answers with the variables for the new app.
 */
export async function downloadTemplate(
  ctx: Context,
  organisationId: string,
  slug: string,
  directory: string,
  given: Record<string, string>
): Promise<Record<string, string>> {
  try {
    assertEmptyFolder(directory);
  } catch (error) {
    throw new CliError((error as Error).message, { exitCode: EXIT.USAGE });
  }
  const { template } = await ctx.api.template(slug);
  // An upload cannot create a database (the backend refuses with UPLOAD_NEEDS_REPO): say so before downloading.
  if (template.creates.database) {
    throw new CliError(`${template.name} needs a database, which an upload cannot create, so it cannot start from a local copy.`, {
      hint: `Deploy it with \`lc templates deploy ${slug} --name <name>\`.`,
      exitCode: EXIT.USAGE,
    });
  }
  // Filled and generated values are set by the platform; required ones come from the user.
  const environmentVars = { ...given };
  for (const variable of template.variables) {
    if (variable.kind !== 'required' || environmentVars[variable.name]) continue;
    environmentVars[variable.name] = await text(variable.hint ? `${variable.name} (${variable.hint})` : variable.name, {
      flag: `--var ${variable.name}=<value>`,
      validate: (value) => (value.trim() ? undefined : 'Required.'),
    });
  }

  const spin = spinner();
  spin.start(`Downloading ${slug}`);
  const download = await ctx.api.templateDownload(slug, organisationId);
  // A public archive (codeload.github.com): fetched without the Light Cloud credential.
  const response = await fetch(download.tarballUrl);
  if (!response.ok) {
    spin.stop('Download failed', 1);
    throw new CliError(`Could not download ${slug} (HTTP ${response.status}).`, { hint: 'Try again in a moment.' });
  }
  const files = unpackTemplate(Buffer.from(await response.arrayBuffer()), directory, download.rootDirectory);
  spin.stop(`${files.length} ${files.length === 1 ? 'file' : 'files'} from ${c.bold(slug)}`);
  return environmentVars;
}
