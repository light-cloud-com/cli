import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Read at runtime from package.json so the bundle and the manifest cannot drift. */
export function cliVersion(): string {
  try {
    const pkg = require('../package.json') as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // dist/ layout: package.json sits one level up from the bundle
  }
  try {
    const pkg = require('../../package.json') as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // src/ layout during development
  }
  return '0.0.0';
}

export const USER_AGENT = `light-cloud-cli/${cliVersion()} (${process.platform}; node ${process.versions.node})`;
