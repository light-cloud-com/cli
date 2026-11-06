import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../lib/api/client.js';
import { LightCloudApi } from '../lib/api/light-cloud.js';
import type { TemplateDeployStatus } from '../lib/api/types.js';
import type { Context } from '../lib/context.js';
import { downloadTemplate, startTemplateDeploy, waitForTemplateApp } from './templates.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('template search', () => {
  it('sends the public API parameter names, without credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, perPage: 24 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new LightCloudApi(new ApiClient({ apiUrl: 'https://api.test', consoleUrl: 'https://console.test', socketUrl: 'https://api.test' }));

    await api.searchTemplates({ query: 'bakery site', runs: 'static,server', language: 'Python', framework: 'nextjs', page: '2' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/public/templates?q=bakery+site&runs=static%2Cserver&lang=Python&fw=nextjs&page=2');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('startTemplateDeploy', () => {
  const api = (providers: string[], blockers: { code: string; message: string }[] = []) => ({
    templateDeployPlan: vi.fn(async () => ({ copyOptions: { providers }, blockers })),
    deployTemplate: vi.fn(async () => ({ templateDeployId: 'td-1', applicationId: null })),
  });
  const request = { organisationId: 'org-1', name: 'my-site' };

  it('copies into the connected git provider by default', async () => {
    const fake = api(['gitlab']);
    await startTemplateDeploy(fake as unknown as LightCloudApi, 'folio', request);
    expect(fake.deployTemplate).toHaveBeenCalledWith('folio', { ...request, copy: 'repo', provider: 'gitlab', via: 'cli' });
  });

  it('deploys read-only when no git provider is connected', async () => {
    const fake = api([]);
    await startTemplateDeploy(fake as unknown as LightCloudApi, 'folio', request);
    expect(fake.deployTemplate).toHaveBeenCalledWith('folio', { ...request, copy: 'readonly', provider: undefined, via: 'cli' });
  });

  it('skips the plan when read-only is asked for', async () => {
    const fake = api(['github']);
    await startTemplateDeploy(fake as unknown as LightCloudApi, 'folio', { ...request, copy: 'readonly' });
    expect(fake.templateDeployPlan).not.toHaveBeenCalled();
    expect(fake.deployTemplate).toHaveBeenCalledWith('folio', { ...request, copy: 'readonly', provider: undefined, via: 'cli' });
  });

  it('refuses with FLAG_OFF, without deploying, when the plan says templates are off', async () => {
    const fake = api(['github'], [{ code: 'FLAG_OFF', message: 'Templates are not available.' }]);
    await expect(startTemplateDeploy(fake as unknown as LightCloudApi, 'wordpress', request)).rejects.toMatchObject({ code: 'FLAG_OFF', status: 409 });
    expect(fake.deployTemplate).not.toHaveBeenCalled();
  });
});

describe('downloadTemplate', () => {
  const temp: string[] = [];
  afterEach(() => {
    for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const target = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-template-'));
    temp.push(dir);
    return path.join(dir, 'site');
  };
  const ctx = (template: Record<string, unknown>) => {
    const api = {
      template: vi.fn(async () => ({ template: { slug: 'folio', name: 'Folio', creates: { app: 'static', database: null }, variables: [], ...template }, similar: [] })),
      templateDownload: vi.fn(async () => ({ tarballUrl: 'https://codeload.test/folio.tar.gz', rootDirectory: null })),
    };
    return { api, ctx: { api } as unknown as Context };
  };
  const required = [{ name: 'SITE_NAME', kind: 'required', hint: null, feature: null }];

  it('refuses a template with a database before downloading', async () => {
    const fake = ctx({ creates: { app: 'server', database: { engine: 'postgresql', tier: 'shared-dev', storageGb: 1 } } });
    await expect(downloadTemplate(fake.ctx, 'org-1', 'opensaas', target(), {})).rejects.toThrow(/needs a database/);
    expect(fake.api.templateDownload).not.toHaveBeenCalled();
  });

  it('asks for a missing required variable before downloading (and names the flag without a terminal)', async () => {
    vi.stubEnv('CI', 'true'); // no terminal to ask in, whatever runs the tests
    const fake = ctx({ variables: required });
    await expect(downloadTemplate(fake.ctx, 'org-1', 'folio', target(), {})).rejects.toMatchObject({ hint: expect.stringContaining('--var SITE_NAME=<value>') });
    expect(fake.api.templateDownload).not.toHaveBeenCalled();
  });

  it('unpacks the template and answers with the variables given', async () => {
    const header = Buffer.alloc(512);
    header.write('folio-main/index.html', 0);
    header.write('0000644\0', 100);
    header.write('00000000002\0', 124);
    header.write('0', 156);
    const archive = gzipSync(Buffer.concat([header, Buffer.from('hi'.padEnd(512, '\0')), Buffer.alloc(1024)]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(archive, { status: 200 })));
    const fake = ctx({ variables: required });
    const dir = target();

    const vars = await downloadTemplate(fake.ctx, 'org-1', 'folio', dir, { SITE_NAME: 'Crumbs' });

    expect(vars).toEqual({ SITE_NAME: 'Crumbs' });
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('hi');
  });
});

describe('waitForTemplateApp', () => {
  const status = (value: TemplateDeployStatus['status'], applicationId: string | null = null): TemplateDeployStatus => ({
    id: 'td-1', status: value, applicationId, environmentId: null, url: null, error: null, template: { slug: 'folio', name: 'Folio' },
  });

  it('polls until the deploy has an application, reporting each step', async () => {
    const templateDeploy = vi.fn()
      .mockResolvedValueOnce(status('queued'))
      .mockResolvedValueOnce(status('creating_database'))
      .mockResolvedValueOnce(status('creating_app', 'app-1'));
    const seen: string[] = [];

    const deploy = await waitForTemplateApp({ templateDeploy }, 'td-1', { intervalMs: 0, onStatus: (s) => seen.push(s) });

    expect(deploy.applicationId).toBe('app-1');
    expect(seen).toEqual(['queued', 'creating_database', 'creating_app']);
  });

  it('stops at a failure', async () => {
    const templateDeploy = vi.fn().mockResolvedValueOnce(status('queued')).mockResolvedValueOnce(status('failed'));
    expect((await waitForTemplateApp({ templateDeploy }, 'td-1', { intervalMs: 0 })).status).toBe('failed');
    expect(templateDeploy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout, saying it carries on', async () => {
    const templateDeploy = vi.fn().mockResolvedValue(status('creating_database'));
    await expect(waitForTemplateApp({ templateDeploy }, 'td-1', { intervalMs: 0, timeoutMs: 0 })).rejects.toThrow(/longer than usual/);
  });
});
