/**
 * `lc init` links a folder to an app — an existing one, or one created on the
 * spot from the local git remote or a source upload. `lc create` is the
 * non-interactive half of the same flow.
 */

import * as path from 'node:path';
import type { Command } from 'commander';
import type { Application, DetectionResult, Environment, RuntimeId } from '../lib/api/types.js';
import { writeProjectConfig } from '../lib/config/project-config.js';
import type { Context } from '../lib/context.js';
import { FRAMEWORKS, getFrameworkById } from '../lib/detection/catalogue.js';
import { detectLocalProject, type LocalDetection } from '../lib/detection/detect.js';
import { detectGit, webUrlFor, type GitInfo } from '../lib/detection/git.js';
import { CliError, EXIT } from '../lib/errors.js';
import { openBrowser } from '../lib/open-browser.js';
import { watchResource } from '../lib/realtime/watch.js';
import { brand, c, emit, isInteractive, isJson, link, log, out, sym } from '../lib/ui/output.js';
import { confirm, intro, note, outro, select, spinner, text } from '../lib/ui/prompts.js';
import { contextFrom, describeDetection, runDeploy, uploadSource, warnIfDirty } from './shared.js';

interface CreateOptions {
  name?: string;
  repo?: string;
  branch?: string;
  upload?: boolean;
  dir: string;
  framework?: string;
  type?: 'static' | 'container';
  build?: string;
  output?: string;
  port?: string;
  root?: string;
  deploy: boolean;
  watch: boolean;
  link: boolean;
  password?: string;
}

export function registerInitCommands(program: Command): void {
  program
    .command('init')
    .description('Link this folder to a Light Cloud app (existing or new)')
    .option('-a, --app <app>', 'link to this existing app without asking')
    .option('-e, --env <env>', 'default environment for `lc deploy` in this folder')
    .option('-d, --dir <path>', 'project folder', '.')
    .action(async (options: { app?: string; env?: string; dir: string }, command: Command) => {
      const ctx = contextFrom(command);
      const directory = path.resolve(options.dir);
      ctx.requireAuth();

      intro(`${brand()} init`);
      const org = await ctx.resolveOrg();
      const detection = detectLocalProject(directory);
      const git = detectGit(directory);

      if (!isJson()) {
        out(`${c.dim('│')}  Folder     ${directory}`);
        out(`${c.dim('│')}  Detected   ${describeDetection(detection)}`);
        if (git.remoteUrl) out(`${c.dim('│')}  Git        ${git.provider ?? git.host ?? 'remote'} ${c.dim(git.remoteUrl)}${git.branch ? c.dim(`  @ ${git.branch}`) : ''}`);
        out(`${c.dim('│')}  Workspace  ${org.name ?? org.id}`);
        out(c.dim('│'));
      }

      let app: Application;
      let created = false;
      if (options.app) {
        app = await ctx.resolveApp(options.app);
      } else {
        ({ app, created } = await chooseOrCreate(ctx, directory, detection, git));
      }

      const envs = app.environments ?? (await ctx.api.listEnvironments(org.id, app.id));
      let env: Environment | undefined;
      if (options.env) env = await ctx.resolveEnv(app, options.env);
      else if (git.branch) env = envs.find((e) => e.github_branch === git.branch) ?? envs.find((e) => e.is_production);
      else env = envs.find((e) => e.is_production);

      const file = writeProjectConfig(
        {
          organisationId: org.id,
          applicationId: app.id,
          applicationName: app.name,
          environmentId: env?.id,
          framework: app.framework,
          deploymentType: app.deployment_type,
        },
        directory
      );

      // A new app starts its first deployment on creation; follow it, so init
      // ends with the address instead of a hint to go and look.
      let url: string | undefined;
      if (created) {
        const watched = await watchResource(ctx.api, env ? { kind: 'environment', id: env.id, organisationId: org.id } : { kind: 'application', id: app.id, organisationId: org.id });
        if (!watched.ok) {
          throw new CliError(watched.update.deployment_error || 'The first deployment failed.', {
            hint: `Fix the build and run \`lc deploy\`. Console: ${ctx.appConsoleUrl(app)}`,
            exitCode: EXIT.FAILED,
          });
        }
        url = watched.update.deployed_url ?? undefined;
      }

      emit({ ok: true, path: file, url, application: { id: app.id, name: app.name }, environment: env ? { id: env.id, name: env.name } : null }, () => {
        note(
          [
            `${c.bold('lc deploy')}        deploy ${env ? env.name : 'the production environment'}`,
            `${c.bold('lc status')}        see environments and URLs`,
            `${c.bold('lc logs -f')}       tail runtime logs`,
            `${c.bold('lc env vars set')}  KEY=value`,
          ].join('\n'),
          'Next'
        );
        outro(url ? `Live at ${link(url)}` : `Linked ${c.bold(app.name)} ${c.dim(sym.arrow)} ${c.dim(file)}`);
      });
    });

  program
    .command('create')
    .description('Create an app from a git repository or a local folder (non-interactive friendly)')
    .option('-n, --name <name>', 'app name (default: folder or repository name)')
    .option('-r, --repo <url>', 'GitHub repository URL (default: the origin remote)')
    .option('-b, --branch <branch>', 'branch to deploy (default: current branch or main)')
    .option('-u, --upload', 'upload the folder instead of connecting a repository')
    .option('-d, --dir <path>', 'project folder', '.')
    .option('-f, --framework <id>', 'framework id (see `lc frameworks`)')
    .option('-t, --type <type>', 'deployment type: static or container')
    .option('--build <command>', 'build command')
    .option('--output <dir>', 'output directory for static sites')
    .option('--port <port>', 'container port')
    .option('--root <dir>', 'monorepo root directory inside the repository')
    .option('--no-deploy', 'create without deploying')
    .option('--no-watch', 'do not follow the first deployment')
    .option('--no-link', 'do not write a .lightcloud file')
    .option('--password <password>', 'gate the site behind a visitor password (6-128 characters)')
    .action(async (options: CreateOptions, command: Command) => {
      const ctx = contextFrom(command);
      const directory = path.resolve(options.dir);
      ctx.requireAuth();
      intro(`${brand()} create`);
      const app = await createApp(ctx, directory, options);
      if (options.link) {
        writeProjectConfig(
          { organisationId: app.organisation_id, applicationId: app.id, applicationName: app.name, framework: app.framework, deploymentType: app.deployment_type },
          directory
        );
      }
      let url: string | undefined = app.deployed_url ?? undefined;
      let status = app.status;
      const env = (app.environments ?? []).find((e) => e.is_production) ?? app.environments?.[0];
      if (options.password && env) {
        const org = await ctx.resolveOrg();
        await ctx.api.setEnvironmentPassword(org.id, env.id, options.password);
        if (!isJson()) log.info('Visitors will be asked for the password.');
      }
      if (options.deploy && options.watch) {
        const org = await ctx.resolveOrg();
        const result = await watchResource(ctx.api, env ? { kind: 'environment', id: env.id, organisationId: org.id } : { kind: 'application', id: app.id, organisationId: org.id });
        url = result.update.deployed_url ?? url;
        status = result.status;
        if (!result.ok) {
          throw new CliError(result.update.deployment_error || 'The first deployment failed.', {
            hint: `Fix the build and run \`lc deploy\`. Console: ${ctx.appConsoleUrl(app)}`,
            exitCode: EXIT.FAILED,
          });
        }
      }
      emit({ ok: true, application: app, status, url }, () => outro(url ? `Live at ${link(url)}` : `Created ${c.bold(app.name)}.`));
    });

  program
    .command('frameworks')
    .description('List framework ids the platform understands')
    .action(async () => {
      emit(FRAMEWORKS, () => {
        for (const category of ['fullstack', 'frontend', 'backend'] as const) {
          out(c.bold(category));
          for (const framework of FRAMEWORKS.filter((f) => f.category === category)) {
            out(`  ${framework.id.padEnd(12)} ${framework.label}${framework.available ? '' : c.dim('  (not yet available)')}`);
          }
          out();
        }
      });
    });
}

// ---- wizard -------------------------------------------------------------------

async function chooseOrCreate(ctx: Context, directory: string, detection: LocalDetection, git: GitInfo): Promise<{ app: Application; created: boolean }> {
  const org = await ctx.resolveOrg();
  const apps = await ctx.api.listApplications(org.id);

  // An app already connected to this repository is almost certainly the one.
  const suggested = git.owner && git.repo
    ? apps.find((app) => app.github_repo_owner?.toLowerCase() === git.owner!.toLowerCase() && app.github_repo_name?.toLowerCase() === git.repo!.toLowerCase())
    : undefined;

  if (!isInteractive()) {
    if (suggested) return { app: await ctx.api.getApplication(org.id, suggested.id), created: false };
    throw new CliError('No terminal to ask in.', {
      hint: 'Pass --app <name> to link an existing app, or use `lc create` for a new one.',
      exitCode: EXIT.USAGE,
    });
  }

  type Choice = 'suggested' | 'existing' | 'new';
  const choices: Array<{ value: Choice; label: string; hint?: string }> = [];
  if (suggested) choices.push({ value: 'suggested', label: `Link ${suggested.name}`, hint: `already connected to ${git.owner}/${git.repo}` });
  choices.push({ value: 'new', label: 'Create a new app', hint: git.provider === 'github' ? `from ${git.owner}/${git.repo}` : 'upload this folder' });
  if (apps.length) choices.push({ value: 'existing', label: 'Link an existing app', hint: `${apps.length} in ${org.name ?? 'workspace'}` });

  const choice = await select<Choice>('What would you like to do?', choices, { flag: '--app <name>' });

  if (choice === 'suggested') return { app: await ctx.api.getApplication(org.id, suggested!.id), created: false };
  if (choice === 'existing') {
    const id = await select<string>(
      'Which app?',
      apps.map((app) => ({ value: app.id, label: app.name, hint: `${app.framework} · ${app.status}` })),
      { flag: '--app <name>' }
    );
    return { app: await ctx.api.getApplication(org.id, id), created: false };
  }

  const app = await createApp(ctx, directory, {
    dir: directory,
    deploy: true,
    watch: true,
    link: false,
    upload: git.provider !== 'github' ? true : undefined,
  }, { detection, git, interactive: true });
  return { app, created: true };
}

// ---- create --------------------------------------------------------------------

interface CreateContext {
  detection?: LocalDetection;
  git?: GitInfo;
  interactive?: boolean;
}

async function createApp(ctx: Context, directory: string, options: CreateOptions, extra: CreateContext = {}): Promise<Application> {
  const org = await ctx.resolveOrg();
  const detection = extra.detection ?? detectLocalProject(directory);
  const git = extra.git ?? detectGit(directory);
  const interactive = extra.interactive ?? isInteractive();

  // ---- source
  let source: 'github' | 'upload';
  let repoUrl = options.repo;
  if (options.upload) source = 'upload';
  else if (repoUrl) source = 'github';
  else if (git.provider === 'github' && git.owner && git.repo) {
    repoUrl = webUrlFor(git);
    source = interactive
      ? await select<'github' | 'upload'>(
          'Deploy from?',
          [
            { value: 'github', label: `GitHub ${git.owner}/${git.repo}`, hint: 'auto-deploys on push' },
            { value: 'upload', label: 'Upload this folder', hint: 'no git connection' },
          ],
          { flag: '--repo <url> or --upload' }
        )
      : 'github';
  } else {
    if (git.provider && git.provider !== 'github') {
      log.warn(`${git.provider} repositories are connected from the console (${ctx.consoleUrl('/new')}); uploading the folder instead.`);
    }
    source = 'upload';
  }

  // ---- what it is
  let framework = options.framework ?? detection.framework;
  let deploymentType = options.type ?? detection.deploymentType;
  let buildCommand = options.build ?? detection.buildCommand;
  let outputDirectory = options.output ?? detection.outputDirectory;
  let containerPort = options.port ? Number(options.port) : detection.containerPort;

  if (options.framework && !getFrameworkById(options.framework)) {
    throw new CliError(`Unknown framework "${options.framework}".`, { hint: 'Run `lc frameworks` for the list.', exitCode: EXIT.USAGE });
  }
  if (options.type && options.type !== 'static' && options.type !== 'container') {
    throw new CliError('--type must be static or container.', { exitCode: EXIT.USAGE });
  }

  if (source === 'github' && repoUrl) {
    const parsed = parseGithubUrl(repoUrl);
    if (!parsed) throw new CliError(`"${repoUrl}" is not a GitHub repository URL.`, { exitCode: EXIT.USAGE });
    const branch = options.branch ?? git.branch ?? 'main';

    const access = await ctx.api.githubInstallationStatus(org.id, parsed.owner, parsed.repo).catch(() => null);
    if (access && (!access.installed || access.repoAccess === false)) {
      const install = await ctx.api.githubInstallUrl().catch(() => null);
      const hint = install?.url ? `Install the Light Cloud GitHub App for ${parsed.owner}: ${install.url}` : `Connect GitHub in the console: ${ctx.consoleUrl('/new')}`;
      if (interactive && install?.url) {
        const go = await confirm(`Light Cloud cannot read ${parsed.owner}/${parsed.repo} yet. Open the GitHub App install page?`, { yes: false, initialValue: true });
        if (go) openBrowser(install.url);
      }
      throw new CliError(`The Light Cloud GitHub App has no access to ${parsed.owner}/${parsed.repo}.`, { hint, exitCode: EXIT.AUTH });
    }

    // Server-side detection reads the actual branch; prefer it over the working tree.
    const spin = spinner();
    spin.start(`Inspecting ${parsed.owner}/${parsed.repo}@${branch}`);
    let remote: DetectionResult | null = null;
    try {
      remote = await ctx.api.detectFramework({ organisationId: org.id, owner: parsed.owner, repo: parsed.repo, branch, rootDirectory: options.root });
      spin.stop(`${remote.framework ? getFrameworkById(remote.framework)?.label ?? remote.framework : 'Unknown framework'} ${c.dim(sym.bullet)} ${remote.deploymentType}${remote.detectedFiles?.length ? c.dim(`  ${remote.detectedFiles.slice(-1)[0]}`) : ''}`);
    } catch {
      spin.stop('Could not inspect the repository; using local detection', 2);
    }
    if (remote) {
      framework = options.framework ?? remote.framework ?? framework;
      deploymentType = options.type ?? remote.deploymentType;
      buildCommand = options.build ?? remote.buildCommand ?? buildCommand;
      outputDirectory = options.output ?? remote.outputDirectory ?? outputDirectory;
      containerPort = options.port ? Number(options.port) : remote.containerPort ?? containerPort;
      if (remote.configWarning) log.warn(remote.configWarning);
    }

    const name = await pickName(options.name ?? parsed.repo, interactive);
    if (interactive) {
      ({ framework, deploymentType } = await confirmKind(framework, deploymentType, interactive));
    }
    if (!framework) throw new CliError('Could not detect the framework.', { hint: 'Pass --framework <id> (see `lc frameworks`).', exitCode: EXIT.USAGE });

    const definition = getFrameworkById(framework);
    const spinCreate = spinner();
    spinCreate.start(`Creating ${name}`);
    const app = await ctx.api.createApplication({
      targetOrganisationId: org.id,
      name,
      githubRepoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
      githubBranch: branch,
      isPrivate: false,
      gitProvider: 'github',
      deploymentType,
      framework,
      runtime: definition?.runtime ?? undefined,
      buildCommand,
      outputDirectory: deploymentType === 'static' ? outputDirectory : undefined,
      containerPort: deploymentType === 'container' ? containerPort : undefined,
      rootDirectory: options.root,
      autoDeployOnPush: true,
    });
    spinCreate.stop(`Created ${c.bold(app.name)} ${c.dim(app.id)}`);
    if (!options.deploy) log.info('Created without deploying; run `lc deploy` when ready.');
    return app;
  }

  // ---- upload
  warnIfDirty(git.isDirty, git.branch);
  if (!framework && !detection.hasDockerfile) {
    if (interactive) {
      framework = await select<string>(
        'What kind of project is this?',
        FRAMEWORKS.filter((f) => f.available).map((f) => ({ value: f.id, label: f.label, hint: f.deploymentType })),
        { flag: '--framework <id>' }
      );
      deploymentType = options.type ?? getFrameworkById(framework)?.deploymentType ?? deploymentType;
    } else {
      throw new CliError(`Could not tell what kind of project ${directory} is.`, { hint: 'Pass --framework <id> (see `lc frameworks`).', exitCode: EXIT.USAGE });
    }
  } else if (interactive) {
    ({ framework, deploymentType } = await confirmKind(framework, deploymentType, interactive));
  }
  const name = await pickName(options.name ?? path.basename(directory), interactive);
  const definition = framework ? getFrameworkById(framework) : undefined;

  const upload = await uploadSource(ctx, directory, { ...detection, framework, deploymentType, buildCommand, outputDirectory });
  // The backend inspected the archive with the console's detector; its reading
  // beats the local guess, but never an explicit flag or an answer given here.
  const server = upload.server.detectionSource === 'server' ? upload.server : undefined;
  if (server) {
    framework = options.framework ?? server.detectedFramework ?? framework;
    deploymentType = options.type ?? (server.detectedDeploymentType as 'static' | 'container' | null) ?? deploymentType;
    buildCommand = options.build ?? server.detectedBuildCommand ?? buildCommand;
    outputDirectory = options.output ?? server.detectedOutputDirectory ?? outputDirectory;
    containerPort = options.port ? Number(options.port) : server.detectedContainerPort ?? containerPort;
  }
  const finalDefinition = framework ? getFrameworkById(framework) : definition;
  const spinCreate = spinner();
  spinCreate.start(`Creating ${name}`);
  const app = await ctx.api.createFromUpload({
    targetOrganisationId: org.id,
    name,
    uploadId: upload.uploadId,
    deploymentType,
    framework: framework ?? (detection.hasDockerfile ? 'custom' : undefined),
    runtime: (server?.detectedRuntime as RuntimeId | null | undefined) ?? finalDefinition?.runtime ?? (detection.hasDockerfile ? 'custom' : undefined),
    buildCommand,
    outputDirectory: deploymentType === 'static' ? outputDirectory : undefined,
    containerPort: deploymentType === 'container' ? containerPort : undefined,
  });
  spinCreate.stop(`Created ${c.bold(app.name)} ${c.dim(app.id)}`);
  if (options.deploy && app.status && !['queued', 'deploying', 'pending'].includes(app.status)) {
    // Creation did not queue a build (older backends); queue one now.
    await runDeploy(ctx, { app, env: (app.environments ?? []).find((e) => e.is_production) ?? null, watch: false });
  }
  return app;
}

async function pickName(suggested: string, interactive: boolean): Promise<string> {
  const cleaned = suggested.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  if (!interactive) return cleaned;
  return text('App name', {
    flag: '--name <name>',
    initialValue: cleaned,
    validate: (value) => (value.trim().length < 2 ? 'At least 2 characters.' : /^[a-z0-9][a-z0-9-]*$/.test(value.trim()) ? undefined : 'Lowercase letters, digits and dashes only.'),
  });
}

async function confirmKind(framework: string | undefined, deploymentType: 'static' | 'container', interactive: boolean): Promise<{ framework?: string; deploymentType: 'static' | 'container' }> {
  if (!interactive) return { framework, deploymentType };
  const label = framework ? getFrameworkById(framework)?.label ?? framework : 'unknown';
  const keep = await confirm(`Deploy as ${c.bold(label)} ${c.dim(sym.bullet)} ${deploymentType}?`, { yes: false, initialValue: true });
  if (keep) return { framework, deploymentType };
  const chosen = await select<string>(
    'Framework',
    FRAMEWORKS.filter((f) => f.available).map((f) => ({ value: f.id, label: f.label, hint: f.category })),
    { flag: '--framework <id>', initialValue: framework }
  );
  const definition = getFrameworkById(chosen)!;
  const type =
    definition.category === 'fullstack' || definition.id === 'html'
      ? await select<'static' | 'container'>(
          'Deployment type',
          [
            { value: 'container', label: 'Container', hint: 'server-rendered, APIs' },
            { value: 'static', label: 'Static site', hint: 'prebuilt HTML/JS on a CDN' },
          ],
          { flag: '--type <type>', initialValue: definition.deploymentType }
        )
      : definition.deploymentType;
  return { framework: chosen, deploymentType: type };
}

export function parseGithubUrl(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i) || value.trim().match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) {
    const short = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return short ? { owner: short[1]!, repo: short[2]! } : null;
  }
  return { owner: match[1]!, repo: match[2]! };
}
