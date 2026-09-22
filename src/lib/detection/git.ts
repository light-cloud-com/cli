/**
 * What the local git checkout says about where this project lives.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RemoteProvider = 'github' | 'gitlab' | 'bitbucket';

export interface GitInfo {
  hasGit: boolean;
  root?: string;
  remoteUrl?: string;
  provider?: RemoteProvider;
  host?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  commit?: string;
  isDirty?: boolean;
}

function git(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

export function detectGit(directory: string = process.cwd()): GitInfo {
  const root = git(['rev-parse', '--show-toplevel'], directory);
  if (!root) {
    return { hasGit: fs.existsSync(path.join(directory, '.git')) };
  }

  const info: GitInfo = { hasGit: true, root };
  info.remoteUrl = git(['remote', 'get-url', 'origin'], directory) || undefined;
  if (info.remoteUrl) Object.assign(info, parseRemote(info.remoteUrl));

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], directory);
  info.branch = branch && branch !== 'HEAD' ? branch : undefined;
  info.commit = git(['rev-parse', '--short', 'HEAD'], directory) || undefined;

  const status = git(['status', '--porcelain'], directory);
  info.isDirty = status === undefined ? undefined : status.length > 0;
  return info;
}

export function parseRemote(url: string): Partial<GitInfo> {
  // https://host/owner/repo(.git) | git@host:owner/repo(.git) | ssh://git@host/owner/repo
  const match =
    url.match(/^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/) ||
    url.match(/^(?:[^@]+@)?([^:/]+):(.+?)(?:\.git)?\/?$/);
  if (!match) return {};
  const host = match[1]!.toLowerCase();
  const segments = match[2]!.split('/').filter(Boolean);
  if (segments.length < 2) return { host };
  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join('/');

  let provider: RemoteProvider | undefined;
  if (host === 'github.com' || host.endsWith('.github.com')) provider = 'github';
  else if (host === 'gitlab.com' || host.includes('gitlab')) provider = 'gitlab';
  else if (host === 'bitbucket.org' || host.includes('bitbucket')) provider = 'bitbucket';

  return { host, owner, repo, provider };
}

/** `https://github.com/owner/repo`, the form the create endpoint expects. */
export function webUrlFor(info: Pick<GitInfo, 'host' | 'owner' | 'repo'>): string | undefined {
  if (!info.host || !info.owner || !info.repo) return undefined;
  return `https://${info.host}/${info.owner}/${info.repo}`;
}
