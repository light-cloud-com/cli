/**
 * Zip a project folder for upload.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import archiver from 'archiver';
import { DEFAULT_EXCLUDES, gitignoreToGlob, parseGitignore } from './excludes.js';

export interface PackageResult {
  buffer: Buffer;
  fileCount: number;
  totalSize: number;
}

export interface PackageOptions {
  directory?: string;
  additionalExcludes?: string[];
  onProgress?: (fileCount: number, totalSize: number) => void;
}

export function buildExcludePatterns(directory: string, additionalExcludes: string[] = []): string[] {
  const patterns = [...DEFAULT_EXCLUDES, ...additionalExcludes];
  const gitignore = path.join(directory, '.gitignore');
  if (fs.existsSync(gitignore)) {
    try {
      for (const pattern of parseGitignore(fs.readFileSync(gitignore, 'utf-8'))) {
        patterns.push(...gitignoreToGlob(pattern));
      }
    } catch {
      // unreadable .gitignore: defaults still apply
    }
  }
  // The link file (.lightcloud) stays on this machine: nothing on the server
  // reads it, and a static site published it to anyone at /.lightcloud.
  return [...new Set([...patterns, '.lightcloud'])];
}

export function packageSource(options: PackageOptions = {}): Promise<PackageResult> {
  const directory = path.resolve(options.directory ?? process.cwd());
  const excludes = buildExcludePatterns(directory, options.additionalExcludes);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let fileCount = 0;
    let totalSize = 0;

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('entry', (entry) => {
      if (entry.stats?.isFile()) {
        fileCount += 1;
        totalSize += entry.stats.size;
        options.onProgress?.(fileCount, totalSize);
      }
    });
    archive.on('warning', (error) => {
      if ((error as { code?: string }).code !== 'ENOENT') reject(error);
    });
    archive.on('error', reject);
    archive.on('end', () => resolve({ buffer: Buffer.concat(chunks), fileCount, totalSize }));

    archive.glob('**/*', { cwd: directory, ignore: excludes, dot: true, nodir: true, follow: false });
    archive.finalize().catch(reject);
  });
}
