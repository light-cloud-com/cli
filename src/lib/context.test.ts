import { describe, expect, it } from 'vitest';
import { findOrg, pickByName } from './context.js';

const orgs = [
  { id: 'org_1', name: 'Acme', role: 'owner' },
  { id: 'org_2', name: 'Acme Labs', role: 'user' },
  { id: 'org_3', name: 'Personal', role: 'owner' },
];

describe('findOrg', () => {
  it('matches by id, then exact name, then a unique partial', () => {
    expect(findOrg(orgs, 'org_3')?.name).toBe('Personal');
    expect(findOrg(orgs, 'acme')?.id).toBe('org_1');
    expect(findOrg(orgs, 'pers')?.id).toBe('org_3');
    expect(findOrg(orgs, 'labs')?.id).toBe('org_2');
  });
});

describe('pickByName', () => {
  const apps = [{ name: 'api' }, { name: 'api-worker' }, { name: 'marketing' }];
  const names = (app: { name: string }) => [app.name];

  it('prefers an exact match over prefixes', () => {
    expect(pickByName(apps, 'api', names)).toEqual({ kind: 'one', item: { name: 'api' } });
  });

  it('accepts a unique prefix or substring', () => {
    expect(pickByName(apps, 'mark', names)).toEqual({ kind: 'one', item: { name: 'marketing' } });
    expect(pickByName(apps, 'worker', names)).toEqual({ kind: 'one', item: { name: 'api-worker' } });
  });

  it('reports ambiguity', () => {
    expect(pickByName(apps, 'ap', names).kind).toBe('many');
    expect(pickByName(apps, 'nothing', names).kind).toBe('none');
  });
});
