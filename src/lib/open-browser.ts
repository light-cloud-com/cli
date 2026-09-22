import { spawn } from 'node:child_process';

/** Open a URL in the default browser; false when that could not be attempted. */
export function openBrowser(url: string): boolean {
  try {
    const child =
      process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
