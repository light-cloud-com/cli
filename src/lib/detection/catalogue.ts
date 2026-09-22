/**
 * Framework catalogue with detection rules.
 *
 * A snapshot of `console-backend/src/const/frameworks.ts`. The API exposes the
 * catalogue at `/api/config/platform` but strips the detection rules, so local
 * detection (needed before an upload exists for the server to inspect) keeps
 * its own copy. Ids, defaults and rules are copied verbatim; when the backend
 * catalogue changes, regenerate this file rather than editing entries by hand:
 *
 *   cd console-backend && npx tsx -e "import {FRAMEWORKS} from './src/const/frameworks';
 *     console.log(JSON.stringify(FRAMEWORKS.map(({icon,color,unavailableReason,env,...f})=>f), null, 2))"
 */

import type { DeploymentType, RuntimeId } from '../api/types.js';

export type ManifestName =
  | 'package.json'
  | 'requirements.txt'
  | 'pyproject.toml'
  | 'go.mod'
  | 'pom.xml'
  | 'build.gradle'
  | 'Gemfile'
  | 'composer.json';

export interface FrameworkDetection {
  npmDeps?: string[];
  npmProdDeps?: string[];
  rootFiles?: string[];
  rootFileExtensions?: string[];
  manifest?: { file: ManifestName; needles: string[] };
  priority: number;
}

export interface FrameworkDefinition {
  id: string;
  label: string;
  category: 'frontend' | 'backend' | 'fullstack';
  runtime: RuntimeId | null;
  deploymentType: DeploymentType;
  buildScript?: string;
  outputDirectory?: string;
  defaultPort?: number;
  available: boolean;
  detection?: FrameworkDetection;
}

export const FRAMEWORKS: FrameworkDefinition[] = [
  { id: 'nextjs', label: 'Next.js', category: 'fullstack', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', outputDirectory: 'out', defaultPort: 3000, available: true, detection: { npmDeps: ['next'], priority: 100 } },
  { id: 'nuxt', label: 'Nuxt', category: 'fullstack', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', outputDirectory: '.output/public', defaultPort: 3000, available: true, detection: { npmDeps: ['nuxt', 'nuxt3'], priority: 100 } },
  { id: 'sveltekit', label: 'SvelteKit', category: 'fullstack', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', outputDirectory: 'build', defaultPort: 3000, available: true, detection: { npmDeps: ['@sveltejs/kit'], priority: 100 } },
  { id: 'remix', label: 'Remix', category: 'fullstack', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', defaultPort: 3000, available: true, detection: { npmDeps: ['@remix-run/dev', '@remix-run/node', '@remix-run/serve'], priority: 100 } },
  { id: 'astro', label: 'Astro', category: 'fullstack', runtime: 'nodejs', deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', defaultPort: 4321, available: true, detection: { npmDeps: ['astro'], priority: 100 } },
  { id: 'django', label: 'Django', category: 'fullstack', runtime: 'python', deploymentType: 'container', defaultPort: 8000, available: true, detection: { rootFiles: ['manage.py'], manifest: { file: 'requirements.txt', needles: ['django'] }, priority: 90 } },
  { id: 'rails', label: 'Ruby on Rails', category: 'fullstack', runtime: 'ruby', deploymentType: 'container', defaultPort: 3000, available: true, detection: { manifest: { file: 'Gemfile', needles: ['rails'] }, priority: 90 } },
  { id: 'laravel', label: 'Laravel', category: 'fullstack', runtime: 'php', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['artisan'], manifest: { file: 'composer.json', needles: ['laravel/framework'] }, priority: 90 } },
  { id: 'symfony', label: 'Symfony', category: 'fullstack', runtime: 'php', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'composer.json', needles: ['symfony/framework-bundle', 'symfony/symfony'] }, priority: 90 } },
  { id: 'wordpress', label: 'WordPress', category: 'fullstack', runtime: 'php', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['wp-config.php', 'wp-config-sample.php', 'wp-load.php', 'wp-settings.php', 'wp-content', 'wp-includes', 'wp-admin'], manifest: { file: 'composer.json', needles: ['johnpbloch/wordpress', 'roots/wordpress', 'wpackagist-'] }, priority: 95 } },
  { id: 'blazor', label: 'Blazor', category: 'fullstack', runtime: 'dotnet', deploymentType: 'container', defaultPort: 8080, available: true },
  { id: 'wasp', label: 'Wasp', category: 'fullstack', runtime: 'nodejs', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['.wasproot', 'main.wasp', 'main.wasp.ts'], npmDeps: ['wasp', '@wasp.sh/spec'], priority: 110 } },
  { id: 'react', label: 'React', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', available: true, detection: { npmDeps: ['react'], priority: 50 } },
  { id: 'vue', label: 'Vue', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', available: true, detection: { npmDeps: ['vue'], priority: 60 } },
  { id: 'angular', label: 'Angular', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist/browser', available: true, detection: { npmDeps: ['@angular/core'], priority: 70 } },
  { id: 'svelte', label: 'Svelte', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', available: true, detection: { npmDeps: ['svelte'], priority: 60 } },
  { id: 'solid', label: 'SolidJS', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', available: true, detection: { npmDeps: ['solid-js'], priority: 70 } },
  { id: 'qwik', label: 'Qwik', category: 'frontend', runtime: 'nodejs', deploymentType: 'static', buildScript: 'build', outputDirectory: 'dist', defaultPort: 3000, available: true, detection: { npmDeps: ['@builder.io/qwik'], priority: 70 } },
  { id: 'nestjs', label: 'NestJS', category: 'backend', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', defaultPort: 3000, available: true, detection: { npmProdDeps: ['@nestjs/core'], priority: 90 } },
  { id: 'adonisjs', label: 'AdonisJS', category: 'backend', runtime: 'nodejs', deploymentType: 'container', buildScript: 'build', defaultPort: 3333, available: true, detection: { npmProdDeps: ['@adonisjs/core'], priority: 90 } },
  { id: 'hono', label: 'Hono', category: 'backend', runtime: 'nodejs', deploymentType: 'container', defaultPort: 3000, available: true, detection: { npmProdDeps: ['hono'], priority: 85 } },
  { id: 'fastify', label: 'Fastify', category: 'backend', runtime: 'nodejs', deploymentType: 'container', defaultPort: 3000, available: true, detection: { npmProdDeps: ['fastify'], priority: 80 } },
  { id: 'express', label: 'Express', category: 'backend', runtime: 'nodejs', deploymentType: 'container', defaultPort: 8080, available: true, detection: { npmProdDeps: ['express', 'koa', '@hapi/hapi', 'hapi'], priority: 80 } },
  { id: 'nodejs', label: 'Node.js', category: 'backend', runtime: 'nodejs', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['package.json'], priority: 10 } },
  { id: 'flask', label: 'Flask', category: 'backend', runtime: 'python', deploymentType: 'container', defaultPort: 8000, available: true, detection: { manifest: { file: 'requirements.txt', needles: ['flask'] }, priority: 85 } },
  { id: 'fastapi', label: 'FastAPI', category: 'backend', runtime: 'python', deploymentType: 'container', defaultPort: 8000, available: true, detection: { manifest: { file: 'requirements.txt', needles: ['fastapi'] }, priority: 86 } },
  { id: 'python', label: 'Python', category: 'backend', runtime: 'python', deploymentType: 'container', defaultPort: 8000, available: true, detection: { rootFiles: ['requirements.txt', 'pyproject.toml', 'setup.py'], priority: 10 } },
  { id: 'gin', label: 'Gin', category: 'backend', runtime: 'go', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'go.mod', needles: ['github.com/gin-gonic/gin'] }, priority: 85 } },
  { id: 'echo', label: 'Echo', category: 'backend', runtime: 'go', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'go.mod', needles: ['github.com/labstack/echo'] }, priority: 85 } },
  { id: 'fiber', label: 'Fiber', category: 'backend', runtime: 'go', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'go.mod', needles: ['github.com/gofiber/fiber'] }, priority: 85 } },
  { id: 'go', label: 'Go', category: 'backend', runtime: 'go', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['go.mod'], priority: 10 } },
  { id: 'springboot', label: 'Spring Boot', category: 'backend', runtime: 'java', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'pom.xml', needles: ['spring-boot'] }, priority: 85 } },
  { id: 'quarkus', label: 'Quarkus', category: 'backend', runtime: 'java', deploymentType: 'container', defaultPort: 8080, available: true, detection: { manifest: { file: 'pom.xml', needles: ['quarkus'] }, priority: 85 } },
  { id: 'java', label: 'Java', category: 'backend', runtime: 'java', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'], priority: 10 } },
  { id: 'sinatra', label: 'Sinatra', category: 'backend', runtime: 'ruby', deploymentType: 'container', defaultPort: 3000, available: true, detection: { manifest: { file: 'Gemfile', needles: ['sinatra'] }, priority: 85 } },
  { id: 'ruby', label: 'Ruby', category: 'backend', runtime: 'ruby', deploymentType: 'container', defaultPort: 3000, available: true, detection: { rootFiles: ['Gemfile', 'config.ru'], priority: 10 } },
  { id: 'aspnet', label: 'ASP.NET', category: 'backend', runtime: 'dotnet', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFileExtensions: ['.csproj', '.sln', '.fsproj'], priority: 10 } },
  { id: 'php', label: 'PHP', category: 'backend', runtime: 'php', deploymentType: 'container', defaultPort: 8080, available: true, detection: { rootFiles: ['composer.json', 'index.php'], priority: 10 } },
  { id: 'gatsby', label: 'Gatsby', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'public', available: true, detection: { npmDeps: ['gatsby'], priority: 95 } },
  { id: 'docusaurus', label: 'Docusaurus', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: 'build', available: true, detection: { npmDeps: ['@docusaurus/core'], priority: 95 } },
  { id: 'eleventy', label: 'Eleventy', category: 'frontend', runtime: null, deploymentType: 'static', buildScript: 'build', outputDirectory: '_site', available: true, detection: { npmDeps: ['@11ty/eleventy'], rootFiles: ['.eleventy.js', 'eleventy.config.js'], priority: 95 } },
  { id: 'html', label: 'Static HTML', category: 'frontend', runtime: null, deploymentType: 'static', outputDirectory: '.', available: true, detection: { rootFiles: ['index.html'], priority: 5 } },
  { id: 'hugo', label: 'Hugo', category: 'frontend', runtime: null, deploymentType: 'static', outputDirectory: 'public', available: false, detection: { rootFiles: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml'], priority: 95 } },
  { id: 'jekyll', label: 'Jekyll', category: 'frontend', runtime: null, deploymentType: 'static', outputDirectory: '_site', available: false, detection: { rootFiles: ['_config.yml'], priority: 95 } },
  { id: 'custom', label: 'Dockerfile', category: 'backend', runtime: 'custom', deploymentType: 'container', defaultPort: 8080, available: true },
];

export function getFrameworkById(id: string): FrameworkDefinition | undefined {
  return FRAMEWORKS.find((framework) => framework.id === id);
}

export const RUNTIME_IDS: RuntimeId[] = ['nodejs', 'python', 'go', 'java', 'ruby', 'php', 'dotnet', 'custom'];

export function isValidFrameworkId(id: string): boolean {
  return FRAMEWORKS.some((framework) => framework.id === id);
}
