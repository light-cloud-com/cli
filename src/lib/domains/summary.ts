import type { DnsRecord, DomainHostname, DomainResult } from '../api/types.js';

/**
 * What a domain result means for the person reading it, worked out apart
 * from printing so it can be tested.
 *
 *   serving      every address that is needed is active and its DNS reaches us
 *   unreachable  the edge says active, yet an address points somewhere else:
 *                visitors do not arrive (the state behind a site that reads
 *                "active" and is down)
 *   waiting      records still have to be created, or are still spreading
 *   failed       the edge gave up; `lc domains retry`
 */
export type DomainState = 'serving' | 'unreachable' | 'waiting' | 'failed';

export interface HostnameLine {
  hostname: string;
  role: 'main address' | 'redirects to main address';
  optional: boolean;
  /** Status to show: the edge's, unless DNS points elsewhere. */
  status: string;
  pointsElsewhere: boolean;
}

export interface DomainSummary {
  state: DomainState;
  hostnames: HostnameLine[];
  required: DnsRecord[];
  optional: DnsRecord[];
  /** Required records that are not in place yet. */
  missing: DnsRecord[];
}

const ownerOf = (record: DnsRecord, fallback: string): string => record.hostname ?? fallback;

export function summariseDomain(result: DomainResult, domain: string): DomainSummary {
  const records = result.dnsRecords ?? [];
  const known: DomainHostname[] = result.hostnames?.length
    ? result.hostnames
    : [{ hostname: domain, role: 'primary', status: result.status ?? null }];
  const main = known.find((h) => h.role === 'primary')?.hostname ?? domain;

  const hostnames: HostnameLine[] = known.map((h) => {
    const pointsElsewhere = records.some(
      (r) => ownerOf(r, main) === h.hostname && r.purpose === 'routing' && r.check?.ok === false
    );
    return {
      hostname: h.hostname,
      role: h.role === 'primary' ? 'main address' : 'redirects to main address',
      optional: h.optional === true,
      status: pointsElsewhere && h.status === 'active' ? 'pending' : (h.status ?? 'pending'),
      pointsElsewhere,
    };
  });

  const needed = hostnames.filter((h) => !h.optional);
  const neededNames = new Set(needed.map((h) => h.hostname));
  const required = records.filter((r) => r.required !== false);
  const optional = records.filter((r) => r.required === false);
  const missing = required.filter(
    (r) => neededNames.has(ownerOf(r, main)) && r.check?.ok === false
  );

  const edgeActive = known
    .filter((h) => !h.optional)
    .every((h) => h.status === 'active');
  const state: DomainState = known.some((h) => !h.optional && h.status === 'failed')
    ? 'failed'
    : edgeActive && needed.some((h) => h.pointsElsewhere)
      ? 'unreachable'
      : edgeActive && missing.length === 0
        ? 'serving'
        : 'waiting';

  return { state, hostnames, required, optional, missing };
}
