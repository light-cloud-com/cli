/**
 * What a command runs against: the API, the workspace, and — when the folder
 * is linked — the application.
 *
 * Resolution order for the workspace: `--org`, the `.lightcloud` file, the
 * saved default, then the only workspace the account has. Anything that needs
 * a person's choice asks in a terminal and fails with the flag to pass
 * otherwise.
 */

import { ApiClient } from './api/client.js';
import { LightCloudApi } from './api/light-cloud.js';
import type { Application, Database, Environment, Organisation, Profile } from './api/types.js';
import { isApiKey, resolveAuth } from './auth/credentials.js';
import { readGlobalConfig, resolveEndpoints, updateGlobalConfig, type Endpoints } from './config/global-config.js';
import { findProjectConfig, type LocatedProjectConfig } from './config/project-config.js';
import { ApiError, CliError, EXIT, notLoggedIn } from './errors.js';
import { c, isInteractive, log } from './ui/output.js';
import { confirm, select } from './ui/prompts.js';

export interface GlobalOptions {
  json?: boolean;
  org?: string;
  apiUrl?: string;
  yes?: boolean;
  color?: boolean;
  cwd?: string;
}

export interface WorkspaceRef {
  id: string;
  name?: string;
  role?: string;
}

/** Sentinel sent when an API key pins the workspace server-side. */
export const API_KEY_ORG_PLACEHOLDER = 'api-key';

const looksLikeId = (value: string): boolean => /^[a-z0-9]{20,}$/i.test(value) || /^[0-9a-f-]{36}$/i.test(value);

export class Context {
  readonly api: LightCloudApi;
  readonly endpoints: Endpoints;
  readonly yes: boolean;
  readonly json: boolean;
  readonly cwd: string;
  readonly project: LocatedProjectConfig | null;
  private readonly orgFlag?: string;
  private profileCache: Profile | null = null;
  private orgCache: WorkspaceRef | null = null;

  constructor(options: GlobalOptions) {
    this.endpoints = resolveEndpoints({ apiUrl: options.apiUrl });
    this.api = new LightCloudApi(new ApiClient(this.endpoints));
    this.yes = Boolean(options.yes);
    this.json = Boolean(options.json);
    this.cwd = options.cwd ?? process.cwd();
    this.project = findProjectConfig(this.cwd);
    this.orgFlag = options.org?.trim() || undefined;
  }

  get usingApiKey(): boolean {
    return isApiKey(resolveAuth().token);
  }

  requireAuth(): void {
    if (!this.api.client.hasCredentials()) throw notLoggedIn();
  }

  async profile(): Promise<Profile> {
    if (this.profileCache) return this.profileCache;
    this.requireAuth();
    this.profileCache = await this.api.profile();
    return this.profileCache;
  }

  // ---- workspace -----------------------------------------------------------

  async resolveOrg(options: { interactive?: boolean } = {}): Promise<WorkspaceRef> {
    if (this.orgCache) return this.orgCache;
    this.requireAuth();

    if (this.usingApiKey) {
      this.orgCache = await this.resolveOrgForApiKey();
      return this.orgCache;
    }

    const profile = await this.profile();
    const orgs = profile.organisations ?? [];

    if (this.orgFlag) {
      const match = findOrg(orgs, this.orgFlag);
      if (!match) {
        throw new CliError(`No workspace called "${this.orgFlag}" on this account.`, {
          hint: `Your workspaces: ${orgs.map((org) => org.name).join(', ') || 'none'}. Run \`lc orgs\` to list them.`,
          exitCode: EXIT.NOT_FOUND,
        });
      }
      this.orgCache = toRef(match);
      return this.orgCache;
    }

    const linked = this.project?.config.organisationId;
    if (linked) {
      const match = orgs.find((org) => org.id === linked);
      if (match) {
        this.orgCache = toRef(match);
        return this.orgCache;
      }
      log.warn(`The linked workspace in ${c.bold('.lightcloud')} is not one you belong to; ignoring it.`);
    }

    const saved = readGlobalConfig().defaultOrganisationId;
    if (saved) {
      const match = orgs.find((org) => org.id === saved);
      if (match) {
        this.orgCache = toRef(match);
        return this.orgCache;
      }
    }

    if (orgs.length === 1) {
      this.orgCache = toRef(orgs[0]!);
      return this.orgCache;
    }
    if (orgs.length === 0) {
      throw new CliError('This account has no workspaces yet.', {
        hint: `Create one in the console: ${this.endpoints.consoleUrl}`,
        exitCode: EXIT.NOT_FOUND,
      });
    }

    if (options.interactive === false || !isInteractive()) {
      throw new CliError('Several workspaces on this account; which one?', {
        hint: `Pass --org <name>, or set a default with \`lc org use <name>\`. Workspaces: ${orgs.map((org) => org.name).join(', ')}.`,
        exitCode: EXIT.USAGE,
      });
    }

    const chosen = await select<string>(
      'Which workspace?',
      orgs.map((org) => ({ value: org.id, label: org.name, hint: org.role })),
      { flag: '--org <name>' }
    );
    const org = orgs.find((entry) => entry.id === chosen)!;
    const remember = await confirm(`Use ${c.bold(org.name)} by default from now on?`, { yes: false, initialValue: true });
    if (remember) updateGlobalConfig({ defaultOrganisationId: org.id, defaultOrganisationName: org.name });
    this.orgCache = toRef(org);
    return this.orgCache;
  }

  /**
   * An API key is bound to one workspace and the profile endpoint does not
   * serve keys, so the id comes from the flag or the link file — or from the
   * first resource the key can see, since every resource names its workspace.
   */
  private async resolveOrgForApiKey(): Promise<WorkspaceRef> {
    const known = this.orgFlag || this.project?.config.organisationId || readGlobalConfig().defaultOrganisationId;
    if (known) return { id: known };
    try {
      const apps = await this.api.listApplications(API_KEY_ORG_PLACEHOLDER, undefined, 1);
      if (apps[0]) return { id: apps[0].organisation_id };
      const dbs = await this.api.listDatabases(API_KEY_ORG_PLACEHOLDER);
      if (dbs[0]) return { id: dbs[0].organisation_id };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new CliError('The API key does not belong to the workspace this folder is linked to.', {
          hint: 'Use a key created in that workspace, or pass --org <id>.',
          exitCode: EXIT.AUTH,
        });
      }
      throw error;
    }
    return { id: API_KEY_ORG_PLACEHOLDER };
  }

  // ---- applications --------------------------------------------------------

  async resolveApp(ref?: string, options: { interactive?: boolean } = {}): Promise<Application> {
    const org = await this.resolveOrg();

    if (ref) {
      if (looksLikeId(ref)) {
        try {
          return await this.api.getApplication(org.id, ref);
        } catch (error) {
          if (!(error instanceof ApiError && (error.status === 404 || error.status === 400))) throw error;
        }
      }
      const apps = await this.api.listApplications(org.id, ref);
      const match = pickByName(apps, ref, (app) => [app.name, app.slug]);
      if (match.kind === 'one') return this.api.getApplication(org.id, match.item.id);
      if (match.kind === 'many') {
        throw new CliError(`"${ref}" matches several apps: ${match.items.map((app) => app.name).join(', ')}.`, {
          hint: 'Use the full name or the id.',
          exitCode: EXIT.USAGE,
        });
      }
      throw new CliError(`No app called "${ref}" in ${org.name ?? 'this workspace'}.`, {
        hint: 'Run `lc apps` to list them.',
        exitCode: EXIT.NOT_FOUND,
      });
    }

    const linked = this.project?.config.applicationId;
    if (linked) {
      try {
        return await this.api.getApplication(org.id, linked);
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
          log.warn(`The app linked in ${c.bold('.lightcloud')} no longer exists.`);
        } else {
          throw error;
        }
      }
    }

    const apps = await this.api.listApplications(org.id);
    if (apps.length === 0) {
      throw new CliError(`No apps in ${org.name ?? 'this workspace'} yet.`, {
        hint: 'Create one with `lc init` in a project folder.',
        exitCode: EXIT.NOT_FOUND,
      });
    }
    if (options.interactive === false || !isInteractive()) {
      throw new CliError('Which app?', {
        hint: 'Pass --app <name>, or link this folder with `lc init`.',
        exitCode: EXIT.USAGE,
      });
    }
    const chosen = await select<string>(
      'Which app?',
      apps.map((app) => ({ value: app.id, label: app.name, hint: `${app.framework} · ${app.status}` })),
      { flag: '--app <name>' }
    );
    return this.api.getApplication(org.id, chosen);
  }

  // ---- environments --------------------------------------------------------

  async resolveEnv(app: Application, ref?: string, options: { interactive?: boolean } = {}): Promise<Environment> {
    const org = await this.resolveOrg();
    const envs = app.environments ?? (await this.api.listEnvironments(org.id, app.id));

    if (ref) {
      const byId = envs.find((env) => env.id === ref);
      if (byId) return byId;
      const match = pickByName(envs, ref, (env) => [env.name, env.github_branch]);
      if (match.kind === 'one') return match.item;
      if (match.kind === 'many') {
        throw new CliError(`"${ref}" matches several environments: ${match.items.map((env) => env.name).join(', ')}.`, {
          exitCode: EXIT.USAGE,
        });
      }
      throw new CliError(`No environment "${ref}" on ${app.name}.`, {
        hint: `Environments: ${envs.map((env) => env.name).join(', ') || 'none'}.`,
        exitCode: EXIT.NOT_FOUND,
      });
    }

    const linked = this.project?.config.environmentId;
    if (linked && this.project?.config.applicationId === app.id) {
      const match = envs.find((env) => env.id === linked);
      if (match) return match;
    }

    if (envs.length === 0) {
      throw new CliError(`${app.name} has no environments.`, {
        hint: 'Create one with `lc env create <name> --branch <branch>`.',
        exitCode: EXIT.NOT_FOUND,
      });
    }
    const production = envs.find((env) => env.is_production);
    if (production) return production;
    if (envs.length === 1) return envs[0]!;

    if (options.interactive === false || !isInteractive()) {
      throw new CliError('Which environment?', {
        hint: `Pass --env <name>. Environments: ${envs.map((env) => env.name).join(', ')}.`,
        exitCode: EXIT.USAGE,
      });
    }
    const chosen = await select<string>(
      'Which environment?',
      envs.map((env) => ({ value: env.id, label: env.name, hint: `${env.github_branch} · ${env.status}` })),
      { flag: '--env <name>' }
    );
    return envs.find((env) => env.id === chosen)!;
  }

  // ---- databases -----------------------------------------------------------

  async resolveDb(ref?: string, options: { interactive?: boolean } = {}): Promise<Database> {
    const org = await this.resolveOrg();
    const dbs = await this.api.listDatabases(org.id);

    if (ref) {
      const byId = dbs.find((db) => db.id === ref);
      if (byId) return byId;
      const match = pickByName(dbs, ref, (db) => [db.name, db.slug, db.database_name ?? '']);
      if (match.kind === 'one') return match.item;
      if (match.kind === 'many') {
        throw new CliError(`"${ref}" matches several databases: ${match.items.map((db) => db.name).join(', ')}.`, { exitCode: EXIT.USAGE });
      }
      throw new CliError(`No database called "${ref}".`, { hint: 'Run `lc dbs` to list them.', exitCode: EXIT.NOT_FOUND });
    }

    if (dbs.length === 0) {
      throw new CliError('No databases in this workspace yet.', { hint: 'Create one with `lc db create`.', exitCode: EXIT.NOT_FOUND });
    }
    if (dbs.length === 1) return dbs[0]!;
    if (options.interactive === false || !isInteractive()) {
      throw new CliError('Which database?', { hint: 'Pass the database name as an argument.', exitCode: EXIT.USAGE });
    }
    const chosen = await select<string>(
      'Which database?',
      dbs.map((db) => ({ value: db.id, label: db.name, hint: `${db.database_type} · ${db.tier} · ${db.status}` })),
      { flag: '<name>' }
    );
    return dbs.find((db) => db.id === chosen)!;
  }

  // ---- links ---------------------------------------------------------------

  consoleUrl(path = ''): string {
    return `${this.endpoints.consoleUrl}${path}`;
  }

  appConsoleUrl(app: Pick<Application, 'id'>): string {
    return this.consoleUrl(`/applications/${app.id}`);
  }

  dbConsoleUrl(db: Pick<Database, 'id'>): string {
    return this.consoleUrl(`/databases/${db.id}`);
  }
}

// ---- helpers -----------------------------------------------------------------

function toRef(org: Organisation): WorkspaceRef {
  return { id: org.id, name: org.name, role: org.role };
}

export function findOrg(orgs: Organisation[], ref: string): Organisation | undefined {
  const needle = ref.trim().toLowerCase();
  return (
    orgs.find((org) => org.id === ref) ??
    orgs.find((org) => org.name.toLowerCase() === needle) ??
    (() => {
      const partial = orgs.filter((org) => org.name.toLowerCase().includes(needle));
      return partial.length === 1 ? partial[0] : undefined;
    })()
  );
}

type Match<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none' };

/** Exact name first, then a unique prefix, then a unique substring. */
export function pickByName<T>(items: T[], ref: string, names: (item: T) => string[]): Match<T> {
  const needle = ref.trim().toLowerCase();
  const exact = items.filter((item) => names(item).some((name) => name.toLowerCase() === needle));
  if (exact.length === 1) return { kind: 'one', item: exact[0]! };
  if (exact.length > 1) return { kind: 'many', items: exact };

  const prefix = items.filter((item) => names(item).some((name) => name.toLowerCase().startsWith(needle)));
  if (prefix.length === 1) return { kind: 'one', item: prefix[0]! };
  if (prefix.length > 1) return { kind: 'many', items: prefix };

  const partial = items.filter((item) => names(item).some((name) => name.toLowerCase().includes(needle)));
  if (partial.length === 1) return { kind: 'one', item: partial[0]! };
  if (partial.length > 1) return { kind: 'many', items: partial };
  return { kind: 'none' };
}
