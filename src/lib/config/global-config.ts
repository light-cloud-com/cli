/**
 * User-level settings in `~/.lightcloud/config.json`.
 *
 * Environment variables override the file so a shell can point one command at
 * staging without editing anything: LIGHT_CLOUD_API_URL and
 * LIGHT_CLOUD_CONSOLE_URL are the same names the MCP server honours.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_DIR } from '../auth/credentials.js';

export interface GlobalConfig {
  defaultOrganisationId?: string;
  defaultOrganisationName?: string;
  apiUrl?: string;
  consoleUrl?: string;
}

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_API_URL = 'https://api.light-cloud.com';
export const DEFAULT_CONSOLE_URL = 'https://console.light-cloud.com';

export function globalConfigPath(): string {
  return CONFIG_FILE;
}

export function readGlobalConfig(): GlobalConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as GlobalConfig) : {};
  } catch {
    return {};
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && value !== '') clean[key] = value;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
}

export function updateGlobalConfig(patch: GlobalConfig): GlobalConfig {
  const next = { ...readGlobalConfig(), ...patch };
  writeGlobalConfig(next);
  return next;
}

export interface Endpoints {
  apiUrl: string;
  consoleUrl: string;
  /** Origin the Socket.IO server listens on: the API URL without `/api`. */
  socketUrl: string;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function resolveEndpoints(overrides: { apiUrl?: string } = {}): Endpoints {
  const config = readGlobalConfig();
  const apiUrl = trimSlash(
    overrides.apiUrl || process.env.LIGHT_CLOUD_API_URL || config.apiUrl || DEFAULT_API_URL
  );
  const consoleUrl = trimSlash(
    process.env.LIGHT_CLOUD_CONSOLE_URL || config.consoleUrl || inferConsoleUrl(apiUrl)
  );
  return { apiUrl, consoleUrl, socketUrl: apiUrl.replace(/\/api$/, '') };
}

/**
 * `api.<domain>` and `console.<domain>` travel together, so a custom API URL
 * (staging, local) implies the matching console without a second setting.
 */
function inferConsoleUrl(apiUrl: string): string {
  try {
    const parsed = new URL(apiUrl);
    if (parsed.hostname.startsWith('api.')) {
      parsed.hostname = 'console.' + parsed.hostname.slice('api.'.length);
      parsed.pathname = '/';
      return trimSlash(parsed.toString());
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return 'http://localhost:5173';
    }
  } catch {
    // fall through to the production console
  }
  return DEFAULT_CONSOLE_URL;
}
