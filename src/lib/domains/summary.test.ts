import { describe, expect, it } from 'vitest';
import type { DomainResult } from '../api/types.js';
import { summariseDomain } from './summary.js';

const routing = (hostname: string, ok: boolean, observed: string | null = null) => ({
  type: hostname.startsWith('www.') ? 'CNAME' : 'ALIAS',
  name: hostname,
  host: hostname.startsWith('www.') ? 'www' : '@',
  value: 'light-cloud.io',
  hostname,
  purpose: 'routing' as const,
  required: true,
  check: { ok, observed },
});

const result = (over: Partial<DomainResult>): DomainResult => ({
  success: true,
  domain: 'www.example.com',
  status: 'active',
  ...over,
});

describe('domain summary', () => {
  it('is serving when every needed address is active and reaches us', () => {
    const summary = summariseDomain(
      result({
        hostnames: [
          { hostname: 'www.example.com', role: 'primary', status: 'active' },
          { hostname: 'example.com', role: 'redirect', status: 'active' },
        ],
        dnsRecords: [routing('www.example.com', true), routing('example.com', true)],
      }),
      'www.example.com'
    );
    expect(summary.state).toBe('serving');
    expect(summary.missing).toEqual([]);
  });

  it('is unreachable when the edge says active but the address points elsewhere', () => {
    const summary = summariseDomain(
      result({
        domain: 'example.com',
        hostnames: [
          { hostname: 'example.com', role: 'primary', status: 'active' },
          { hostname: 'www.example.com', role: 'redirect', status: 'active' },
        ],
        dnsRecords: [
          routing('example.com', false, '75.126.104.254'),
          routing('www.example.com', true),
        ],
      }),
      'example.com'
    );
    expect(summary.state).toBe('unreachable');
    expect(summary.hostnames[0]).toMatchObject({ status: 'pending', pointsElsewhere: true });
    expect(summary.missing.map((r) => r.name)).toEqual(['example.com']);
  });

  it('does not wait for a root the provider cannot serve', () => {
    const summary = summariseDomain(
      result({
        hostnames: [
          { hostname: 'www.example.com', role: 'primary', status: 'active' },
          { hostname: 'example.com', role: 'redirect', status: 'pending_verification', optional: true },
        ],
        dnsRecords: [
          routing('www.example.com', true),
          { ...routing('example.com', false), required: false },
        ],
      }),
      'www.example.com'
    );
    expect(summary.state).toBe('serving');
    expect(summary.optional).toHaveLength(1);
  });

  it('is waiting while a required record is not there, and ignores optional ones', () => {
    const summary = summariseDomain(
      result({
        status: 'pending_verification',
        hostnames: [{ hostname: 'app.example.com', role: 'primary', status: 'pending_verification' }],
        dnsRecords: [
          { ...routing('app.example.com', false), type: 'CNAME', host: 'app' },
          {
            type: 'TXT',
            name: '_acme-challenge.app.example.com',
            host: '_acme-challenge.app',
            value: 'x',
            hostname: 'app.example.com',
            purpose: 'ssl',
            required: false,
            check: { ok: false, observed: null },
          },
        ],
      }),
      'app.example.com'
    );
    expect(summary.state).toBe('waiting');
    expect(summary.missing).toHaveLength(1);
  });

  it('reads an answer from an older API that names no hostnames', () => {
    const summary = summariseDomain(
      result({ dnsRecords: [{ type: 'CNAME', name: 'www.example.com', value: 'light-cloud.io' }] }),
      'www.example.com'
    );
    expect(summary.state).toBe('serving');
    expect(summary.hostnames).toHaveLength(1);
  });

  it('reports a failed address', () => {
    const summary = summariseDomain(
      result({
        status: 'failed',
        hostnames: [{ hostname: 'www.example.com', role: 'primary', status: 'failed' }],
      }),
      'www.example.com'
    );
    expect(summary.state).toBe('failed');
  });
});
