/**
 * Credential storage.
 *
 * The file and its field names are shared with the Light Cloud MCP server
 * (`~/.lightcloud/credentials.json`), so signing in once serves both. The CLI
 * adds one optional field, `apiKey`, which the MCP server ignores.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface StoredCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  apiKey?: string;
}

export const CONFIG_DIR = path.join(os.homedir(), '.lightcloud');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

export function credentialsPath(): string {
  return CREDENTIALS_FILE;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readCredentials(): StoredCredentials {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as StoredCredentials) : {};
  } catch {
    return {};
  }
}

export function writeCredentials(credentials: StoredCredentials): void {
  ensureConfigDir();
  const clean: StoredCredentials = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (value !== undefined && value !== null && value !== '') {
      (clean as Record<string, unknown>)[key] = value;
    }
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(clean, null, 2) + '\n', {
    mode: 0o600,
  });
}

/** Merge new values over what is stored, keeping unrelated fields. */
export function updateCredentials(patch: StoredCredentials): void {
  writeCredentials({ ...readCredentials(), ...patch });
}

export function clearCredentials(): void {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // nothing to clear
  }
}

export type AuthSource = 'env-api-key' | 'stored-api-key' | 'session' | 'none';

export interface ResolvedAuth {
  source: AuthSource;
  token: string | null;
}

/**
 * Which credential a request should carry, in order of precedence:
 * an API key from the environment (CI), a stored API key, then a browser
 * session. The environment wins so a CI job can never accidentally run as a
 * developer's personal session.
 */
export function resolveAuth(): ResolvedAuth {
  const fromEnv = process.env.LIGHT_CLOUD_API_KEY?.trim();
  if (fromEnv) return { source: 'env-api-key', token: fromEnv };

  const stored = readCredentials();
  if (stored.apiKey) return { source: 'stored-api-key', token: stored.apiKey };
  if (stored.accessToken) return { source: 'session', token: stored.accessToken };
  return { source: 'none', token: null };
}

export function isApiKey(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith('lc_');
}
