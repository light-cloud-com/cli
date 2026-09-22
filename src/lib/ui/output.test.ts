import { describe, expect, it } from 'vitest';
import { configureOutput, formatBytes, formatDuration, maskSecret, relativeTime, renderTable, stripAnsi, truncate, visibleLength } from './output.js';

describe('formatting helpers', () => {
  it('formats durations at a human scale', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
  });

  it('describes recent times relatively', () => {
    expect(relativeTime(new Date(Date.now() - 10_000))).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000))).toBe('3h ago');
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000))).toBe('2d ago');
  });

  it('masks secrets but keeps a recognisable edge', () => {
    expect(maskSecret('abc')).toBe('••••••');
    expect(maskSecret('sk_live_1234567890')).toMatch(/^sk_•+90$/);
  });

  it('strips ANSI codes when measuring and truncating', () => {
    configureOutput({ color: true });
    const coloured = '[31mhello world[39m';
    expect(stripAnsi(coloured)).toBe('hello world');
    expect(visibleLength(coloured)).toBe(11);
    expect(truncate(coloured, 6)).toBe('hello…');
    expect(truncate('short', 10)).toBe('short');
  });

  it('renders aligned tables without colour', () => {
    configureOutput({ color: false });
    const table = renderTable(
      [
        { name: 'api', status: 'deployed' },
        { name: 'marketing-site', status: 'failed' },
      ],
      [
        { header: 'App', cell: (row) => row.name },
        { header: 'Status', cell: (row) => row.status },
      ],
      { indent: '' }
    );
    expect(table.split('\n')).toEqual(['APP             STATUS  ', 'api             deployed', 'marketing-site  failed  ']);
  });
});
