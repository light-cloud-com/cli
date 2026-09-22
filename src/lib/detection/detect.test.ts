import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLocalProject } from './detect.js';

let dir: string;

function write(file: string, contents: string): void {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-detect-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('detectLocalProject', () => {
  it('reports an empty folder as unknown', () => {
    const result = detectLocalProject(dir);
    expect(result.framework).toBeUndefined();
    expect(result.confidence).toBe('low');
  });

  it('prefers Next.js over React and treats it as a container by default', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '14', react: '18' }, scripts: { build: 'next build', start: 'next start' } }));
    write('package-lock.json', '{}');
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('nextjs');
    expect(result.deploymentType).toBe('container');
    expect(result.containerPort).toBe(3000);
    expect(result.buildCommand).toBe('npm run build');
    expect(result.startCommand).toBe('npm start');
    expect(result.installCommand).toBe('npm ci');
  });

  it('turns Next.js with output: export into a static site', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '14' }, scripts: { build: 'next build' } }));
    write('next.config.js', "module.exports = { output: 'export', distDir: 'site' }");
    const result = detectLocalProject(dir);
    expect(result.deploymentType).toBe('static');
    expect(result.outputDirectory).toBe('site');
  });

  it('detects a Vite React app as static with dist output and pnpm', () => {
    write('package.json', JSON.stringify({ dependencies: { react: '18' }, devDependencies: { vite: '5' }, scripts: { build: 'vite build' } }));
    write('pnpm-lock.yaml', '');
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('react');
    expect(result.deploymentType).toBe('static');
    expect(result.outputDirectory).toBe('dist');
    expect(result.buildCommand).toBe('pnpm run build');
  });

  it('only counts a server framework when it is a production dependency', () => {
    write('package.json', JSON.stringify({ devDependencies: { fastify: '4' } }));
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('nodejs');
  });

  it('matches whole names in requirements.txt', () => {
    write('requirements.txt', 'jquery-rails\nflask==3.0\n');
    expect(detectLocalProject(dir).framework).toBe('flask');
  });

  it('does not let jquery-rails look like Rails', () => {
    write('Gemfile', "gem 'jquery-rails'\ngem 'sinatra'\n");
    expect(detectLocalProject(dir).framework).toBe('sinatra');
  });

  it('recognises Go frameworks from go.mod', () => {
    write('go.mod', 'module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.0\n');
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('gin');
    expect(result.deploymentType).toBe('container');
    expect(result.containerPort).toBe(8080);
  });

  it('falls back to a Dockerfile when nothing else matches', () => {
    write('Dockerfile', 'FROM scratch');
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('custom');
    expect(result.deploymentType).toBe('container');
    expect(result.hasDockerfile).toBe(true);
  });

  it('lists env files it found', () => {
    write('index.html', '<html></html>');
    write('.env', 'A=1');
    write('.env.example', 'A=');
    const result = detectLocalProject(dir);
    expect(result.framework).toBe('html');
    expect(result.envFiles).toEqual(['.env', '.env.example']);
  });
});
