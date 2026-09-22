import { describe, expect, it } from 'vitest';
import { parseDotenv, parsePairs, quoteDotenv } from './envs.js';

describe('env var parsing', () => {
  it('parses KEY=value pairs, keeping = inside values', () => {
    expect(parsePairs(['A=1', 'URL=postgres://u:p@h/db?x=1'])).toEqual({ A: '1', URL: 'postgres://u:p@h/db?x=1' });
  });

  it('rejects malformed pairs and bad names', () => {
    expect(() => parsePairs(['NOVALUE'])).toThrow(/KEY=value/);
    expect(() => parsePairs(['1ABC=x'])).toThrow(/valid variable name/);
  });

  it('reads dotenv files with quotes, comments and export prefixes', () => {
    const parsed = parseDotenv(['# comment', 'export A=1', 'B="two words"', "C='single'", 'D=plain # trailing', 'E="line\\nbreak"', '', 'invalid line'].join('\n'));
    expect(parsed).toEqual({ A: '1', B: 'two words', C: 'single', D: 'plain', E: 'line\nbreak' });
  });

  it('quotes values that need it when exporting', () => {
    expect(quoteDotenv('simple_value-1')).toBe('simple_value-1');
    expect(quoteDotenv('two words')).toBe('"two words"');
    expect(quoteDotenv('say "hi"')).toBe('"say \\"hi\\""');
  });
});
