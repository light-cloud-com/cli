/**
 * The `.lightcloud` file links a folder to an application.
 *
 * Same schema the MCP server and the VS Code extension write, so a project
 * linked from any of the three works in the others. Lookup walks up from the
 * working directory and stops at the repository root, which is what makes
 * `lc deploy` work from a subfolder of a linked repo.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const PROJECT_CONFIG_FILENAME = '.lightcloud';

export interface ProjectConfig {
  organisationId?: string;
  applicationId?: string;
  environmentId?: string;
  applicationName?: string;
  framework?: string;
  deploymentType?: 'static' | 'container';
}

export interface LocatedProjectConfig {
  config: ProjectConfig;
  path: string;
  directory: string;
}

export function findProjectConfig(startDir: string = process.cwd()): LocatedProjectConfig | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, PROJECT_CONFIG_FILENAME);
    const config = readProjectConfigFile(candidate);
    if (config) return { config, path: candidate, directory: dir };

    // A repository root is the outer boundary of a project.
    if (fs.existsSync(path.join(dir, '.git'))) return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readProjectConfig(directory: string = process.cwd()): ProjectConfig | null {
  return readProjectConfigFile(path.join(directory, PROJECT_CONFIG_FILENAME));
}

function readProjectConfigFile(file: string): ProjectConfig | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as ProjectConfig) : null;
  } catch {
    return null;
  }
}

export function writeProjectConfig(config: ProjectConfig, directory: string = process.cwd()): string {
  const file = path.join(directory, PROJECT_CONFIG_FILENAME);
  const merged: Record<string, unknown> = { ...(readProjectConfig(directory) ?? {}), ...config };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return file;
}

export function deleteProjectConfig(directory: string = process.cwd()): boolean {
  const file = path.join(directory, PROJECT_CONFIG_FILENAME);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
