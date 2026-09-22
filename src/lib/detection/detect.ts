/**
 * Local framework detection.
 *
 * Gathers the same signals the server reads from a repository (root files,
 * package.json dependencies, manifest contents) and matches them against the
 * catalogue with the server's rules, so a folder and its GitHub mirror detect
 * the same way. Refinement then reads the framework's own config for the
 * static-versus-container decision that a dependency list cannot settle.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DeploymentType, RuntimeId } from '../api/types.js';
import {
  FRAMEWORKS,
  getFrameworkById,
  type FrameworkDefinition,
  type FrameworkDetection,
  type ManifestName,
} from './catalogue.js';

export interface RepositorySignals {
  rootFiles: string[];
  npmDependencies: string[];
  npmProdDependencies: string[];
  manifests: Partial<Record<ManifestName, string>>;
  packageJson: PackageJson | null;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  packageManager?: string;
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface LocalDetection {
  framework?: string;
  frameworkLabel?: string;
  runtime?: RuntimeId;
  deploymentType: DeploymentType;
  packageManager?: PackageManager;
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  outputDirectory?: string;
  containerPort?: number;
  hasDockerfile: boolean;
  envFiles: string[];
  nodeVersion?: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

const MANIFEST_FILES: ManifestName[] = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
];

const ENV_FILES = ['.env', '.env.local', '.env.example', '.env.development', '.env.production'];

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

export function gatherSignals(directory: string): RepositorySignals {
  let rootFiles: string[] = [];
  try {
    rootFiles = fs.readdirSync(directory);
  } catch {
    rootFiles = [];
  }

  const manifests: Partial<Record<ManifestName, string>> = {};
  for (const name of MANIFEST_FILES) {
    if (rootFiles.includes(name)) {
      const contents = readIfExists(path.join(directory, name));
      if (contents !== undefined) manifests[name] = contents;
    }
  }
  // Gradle and pyproject carry the same names the needles are written for.
  if (!manifests['pom.xml'] && rootFiles.includes('build.gradle.kts')) {
    manifests['pom.xml'] = readIfExists(path.join(directory, 'build.gradle.kts'));
  }
  if (!manifests['pom.xml'] && manifests['build.gradle']) manifests['pom.xml'] = manifests['build.gradle'];
  if (!manifests['requirements.txt'] && manifests['pyproject.toml']) {
    manifests['requirements.txt'] = manifests['pyproject.toml'];
  }

  let packageJson: PackageJson | null = null;
  if (manifests['package.json']) {
    try {
      packageJson = JSON.parse(manifests['package.json']) as PackageJson;
    } catch {
      packageJson = null;
    }
  }

  const prod = Object.keys(packageJson?.dependencies ?? {});
  const dev = Object.keys(packageJson?.devDependencies ?? {});

  return {
    rootFiles,
    npmDependencies: [...new Set([...prod, ...dev])],
    npmProdDependencies: prod,
    manifests,
    packageJson,
  };
}

const WHOLE_NAME_MANIFESTS: ReadonlySet<string> = new Set(['Gemfile', 'requirements.txt']);

function manifestNeedleMatches(file: ManifestName, haystack: string, needle: string): boolean {
  const lowered = needle.toLowerCase();
  if (!WHOLE_NAME_MANIFESTS.has(file)) return haystack.includes(lowered);
  const escaped = lowered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`, 'm').test(haystack);
}

function matchesDetection(detection: FrameworkDetection, signals: RepositorySignals): boolean {
  if (detection.npmDeps?.some((dep) => signals.npmDependencies.includes(dep))) return true;
  if (detection.npmProdDeps?.some((dep) => signals.npmProdDependencies.includes(dep))) return true;
  if (detection.rootFiles?.some((file) => signals.rootFiles.includes(file))) return true;
  if (detection.rootFileExtensions?.some((ext) => signals.rootFiles.some((file) => file.toLowerCase().endsWith(ext)))) {
    return true;
  }
  if (detection.manifest) {
    const contents = signals.manifests[detection.manifest.file];
    if (contents) {
      const haystack = contents.toLowerCase();
      if (detection.manifest.needles.some((needle) => manifestNeedleMatches(detection.manifest!.file, haystack, needle))) {
        return true;
      }
    }
  }
  return false;
}

export function matchFramework(signals: RepositorySignals): FrameworkDefinition | null {
  let best: FrameworkDefinition | null = null;
  let bestPriority = -1;
  for (const framework of FRAMEWORKS) {
    if (!framework.detection) continue;
    if (!matchesDetection(framework.detection, signals)) continue;
    if (framework.detection.priority > bestPriority) {
      best = framework;
      bestPriority = framework.detection.priority;
    }
  }
  return best;
}

export function resolvePackageManager(rootFiles: string[], packageJson: PackageJson | null): PackageManager {
  const declared = packageJson?.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') return declared;
  if (rootFiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (rootFiles.includes('yarn.lock')) return 'yarn';
  if (rootFiles.includes('bun.lockb') || rootFiles.includes('bun.lock')) return 'bun';
  return 'npm';
}

function installCommandFor(pm: PackageManager, rootFiles: string[]): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      return 'yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install';
    default:
      return rootFiles.includes('package-lock.json') ? 'npm ci' : 'npm install';
  }
}

function runScript(pm: PackageManager, script: string): string {
  if (pm === 'npm' && script === 'start') return 'npm start';
  return `${pm} run ${script}`;
}

interface Refinement {
  deploymentType: DeploymentType;
  outputDirectory?: string;
  containerPort?: number;
  framework?: string;
  notes: string[];
}

function readFirst(directory: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const contents = readIfExists(path.join(directory, candidate));
    if (contents !== undefined) return contents;
  }
  return undefined;
}

/** Framework config decides static versus container where the catalogue cannot. */
function refineDeployment(framework: FrameworkDefinition, directory: string, signals: RepositorySignals): Refinement {
  const base: Refinement = {
    deploymentType: framework.deploymentType,
    outputDirectory: framework.outputDirectory,
    containerPort: framework.defaultPort,
    notes: [],
  };

  switch (framework.id) {
    case 'nextjs': {
      const config = readFirst(directory, ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.mts', 'next.config.cjs']);
      const output = config?.match(/output\s*:\s*['"`](\w+)['"`]/)?.[1];
      const distDir = config?.match(/distDir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      if (output === 'export') {
        return { deploymentType: 'static', outputDirectory: distDir || 'out', notes: ['output: export'] };
      }
      return {
        deploymentType: 'container',
        containerPort: 3000,
        notes: [output === 'standalone' ? 'output: standalone' : 'SSR mode'],
      };
    }
    case 'nuxt': {
      const config = readFirst(directory, ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs']);
      const prerendered = config ? /ssr\s*:\s*false|preset\s*:\s*['"`]static['"`]|prerender\s*:\s*\{[^}]*routes/.test(config) : false;
      if (prerendered) {
        return { deploymentType: 'static', outputDirectory: '.output/public', notes: ['prerendered'] };
      }
      return { deploymentType: 'container', containerPort: 3000, notes: ['SSR mode'] };
    }
    case 'astro': {
      const config = readFirst(directory, ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.cjs']);
      const serverOutput = config ? /output\s*:\s*['"`](server|hybrid)['"`]/.test(config) : false;
      const hasNodeAdapter = signals.npmDependencies.includes('@astrojs/node');
      if (serverOutput || hasNodeAdapter) {
        return { deploymentType: 'container', containerPort: 4321, notes: ['server output'] };
      }
      return { deploymentType: 'static', outputDirectory: 'dist', notes: ['static output'] };
    }
    case 'sveltekit': {
      if (signals.npmDependencies.includes('@sveltejs/adapter-static')) {
        return { deploymentType: 'static', outputDirectory: 'build', notes: ['adapter-static'] };
      }
      return { deploymentType: 'container', containerPort: 3000, notes: ['adapter-node'] };
    }
    case 'react': {
      if (!signals.npmDependencies.includes('vite') && signals.npmDependencies.includes('react-scripts')) {
        return { ...base, outputDirectory: 'build', notes: ['create-react-app'] };
      }
      return base;
    }
    case 'angular': {
      const angularJson = readIfExists(path.join(directory, 'angular.json'));
      const outputPath = angularJson?.match(/"outputPath"\s*:\s*"([^"]+)"/)?.[1];
      if (outputPath) return { ...base, outputDirectory: outputPath.endsWith('/browser') ? outputPath : `${outputPath}/browser`, notes: [] };
      return base;
    }
    default:
      return base;
  }
}

export function detectLocalProject(directory: string = process.cwd()): LocalDetection {
  const signals = gatherSignals(directory);
  const hasDockerfile = signals.rootFiles.includes('Dockerfile');
  const envFiles = ENV_FILES.filter((file) => signals.rootFiles.includes(file));

  const matched = matchFramework(signals);

  if (!matched) {
    if (hasDockerfile) {
      const custom = getFrameworkById('custom')!;
      return {
        framework: custom.id,
        frameworkLabel: custom.label,
        runtime: 'custom',
        deploymentType: 'container',
        containerPort: custom.defaultPort,
        hasDockerfile,
        envFiles,
        confidence: 'medium',
        notes: ['Dockerfile at root'],
      };
    }
    return { deploymentType: 'static', hasDockerfile, envFiles, confidence: 'low', notes: [] };
  }

  const refinement = refineDeployment(matched, directory, signals);
  const reported = (refinement.framework && getFrameworkById(refinement.framework)) || matched;
  const isNode = reported.runtime === 'nodejs' || reported.runtime === null;
  const scripts = signals.packageJson?.scripts ?? {};

  const result: LocalDetection = {
    framework: reported.id,
    frameworkLabel: reported.label,
    runtime: reported.runtime ?? undefined,
    deploymentType: refinement.deploymentType,
    outputDirectory: refinement.deploymentType === 'static' ? refinement.outputDirectory : undefined,
    containerPort: refinement.deploymentType === 'container' ? refinement.containerPort : undefined,
    hasDockerfile,
    envFiles,
    nodeVersion: signals.packageJson?.engines?.node,
    confidence: matched.detection && matched.detection.priority >= 50 ? 'high' : 'medium',
    notes: [...refinement.notes],
  };

  if (isNode && signals.packageJson) {
    const pm = resolvePackageManager(signals.rootFiles, signals.packageJson);
    result.packageManager = pm;
    result.installCommand = installCommandFor(pm, signals.rootFiles);
    const buildScript = reported.buildScript && scripts[reported.buildScript] ? reported.buildScript : scripts.build ? 'build' : undefined;
    if (buildScript) result.buildCommand = runScript(pm, buildScript);
    if (scripts.start && refinement.deploymentType === 'container') result.startCommand = runScript(pm, 'start');
  }

  // A static frontend with no build script is served as-is.
  if (result.deploymentType === 'static' && !result.buildCommand && reported.id !== 'html' && isNode) {
    result.notes.push('no build script found');
  }

  if (hasDockerfile && result.deploymentType === 'container') {
    result.notes.push('Dockerfile at root');
  }

  return result;
}
