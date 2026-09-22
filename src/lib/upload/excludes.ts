/**
 * What never goes into a source upload.
 *
 * Mirrors the MCP server's list so a folder uploads identically from either.
 * `.gitignore` entries are added on top at package time.
 */

export const DEFAULT_EXCLUDES: string[] = [
  '.git', '.git/**', '.svn', '.svn/**', '.hg', '.hg/**',
  'node_modules', 'node_modules/**', 'vendor', 'vendor/**', 'bower_components', 'bower_components/**',
  '__pycache__', '__pycache__/**', '*.pyc', '*.pyo', '*.pyd', '.Python',
  'venv', 'venv/**', '.venv', '.venv/**', 'env', 'env/**', '.env',
  'pip-wheel-metadata', '*.egg-info', '*.egg-info/**',
  'dist', 'dist/**', 'build', 'build/**', 'out', 'out/**',
  '.next', '.next/**', '.nuxt', '.nuxt/**', '.svelte-kit', '.svelte-kit/**',
  '.cache', '.cache/**', '.parcel-cache', '.parcel-cache/**', '.turbo', '.turbo/**',
  '.idea', '.idea/**', '.vscode', '.vscode/**', '*.swp', '*.swo', '*~',
  '.project', '.classpath', '.settings', '.settings/**',
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
  '*.log', 'logs', 'logs/**', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*',
  'coverage', 'coverage/**', '.nyc_output', '.nyc_output/**', 'htmlcov', 'htmlcov/**',
  'tmp', 'tmp/**', 'temp', 'temp/**', '.tmp', '.tmp/**',
  '*.zip', '*.tar', '*.tar.gz', '*.tgz', '*.rar', '*.7z',
];

export function parseGitignore(content: string): string[] {
  const patterns: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    patterns.push(line);
  }
  return patterns;
}

export function gitignoreToGlob(pattern: string): string[] {
  let normalized = pattern.replace(/^\//, '');
  const patterns: string[] = [];
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
    patterns.push(normalized, `${normalized}/**`);
  } else {
    patterns.push(normalized, `${normalized}/**`);
  }
  // A bare name in .gitignore matches at any depth.
  if (!normalized.includes('/')) {
    patterns.push(`**/${normalized}`, `**/${normalized}/**`);
  }
  return patterns;
}
