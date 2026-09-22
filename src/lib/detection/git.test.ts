import { describe, expect, it } from 'vitest';
import { parseRemote, webUrlFor } from './git.js';

describe('parseRemote', () => {
  it('parses https and ssh GitHub remotes', () => {
    expect(parseRemote('https://github.com/acme/app.git')).toMatchObject({ host: 'github.com', owner: 'acme', repo: 'app', provider: 'github' });
    expect(parseRemote('git@github.com:acme/app.git')).toMatchObject({ owner: 'acme', repo: 'app', provider: 'github' });
    expect(parseRemote('ssh://git@github.com/acme/app')).toMatchObject({ owner: 'acme', repo: 'app' });
  });

  it('keeps GitLab subgroups in the owner', () => {
    expect(parseRemote('https://gitlab.com/group/sub/app.git')).toMatchObject({ owner: 'group/sub', repo: 'app', provider: 'gitlab' });
  });

  it('recognises Bitbucket', () => {
    expect(parseRemote('git@bitbucket.org:team/app.git')).toMatchObject({ provider: 'bitbucket' });
  });

  it('builds a web URL', () => {
    expect(webUrlFor({ host: 'github.com', owner: 'acme', repo: 'app' })).toBe('https://github.com/acme/app');
    expect(webUrlFor({})).toBeUndefined();
  });
});
