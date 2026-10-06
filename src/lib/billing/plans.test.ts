import { describe, expect, it } from 'vitest';
import type { PlanCatalogEntry } from '../api/light-cloud.js';
import {
  annualPrice,
  findPlan,
  includedUsage,
  pausedNotice,
  pausedOnFree,
  pendingIntervalNote,
  planLimits,
  planName,
  price,
  requiredPlanHint,
  usageLimitNote,
} from './plans.js';

// The 2026-10-06 rows (docs/PRICING_REDESIGN.md §6); the free row still named Hobby, as production may be.
const free: PlanCatalogEntry = {
  id: 'hobby',
  name: 'Hobby',
  price: 0,
  entitlements: {
    seats: 1, services: 3, sites: null, databases: 0, databasesAllowed: false, alwaysOnAllowed: false,
    customDomainsAllowed: false, maxInstances: 3, containerSizes: ['nano', 'micro'], databaseTiers: [],
    staticBandwidthGb: 20, usageCredits: 1,
  },
};
const lite: PlanCatalogEntry = {
  id: 'lite',
  name: 'Lite',
  price: 5,
  entitlements: {
    seats: 1, services: 5, sites: null, databases: 1, databasesAllowed: true, alwaysOnAllowed: false,
    customDomainsAllowed: true, containerSizes: ['nano', 'micro'], databaseTiers: ['shared-dev'], staticBandwidthGb: 1000,
  },
};
const starter: PlanCatalogEntry = {
  id: 'starter',
  name: 'Starter',
  price: 19,
  entitlements: { seats: 3, extraSeatAllowed: false, services: 10, sites: null, databasesAllowed: true, alwaysOnAllowed: true },
};
const business: PlanCatalogEntry = { id: 'business', name: 'Business', price: 149, entitlements: { seats: null, services: 100, annualPrice: 1400 } };

describe('plan names and prices', () => {
  it('calls the free plan Free and finds it by that name', () => {
    expect(planName(free)).toBe('Free');
    expect(findPlan([free, lite], 'free')).toBe(free);
    expect(findPlan([free, lite], 'Hobby')).toBe(free);
    expect(findPlan([free, lite], 'LITE')).toBe(lite);
    expect(findPlan([free, lite], 'gold')).toBeUndefined();
  });

  it('prints prices in whole dollars and bills a year at two months free', () => {
    expect(price(19)).toBe('$19');
    expect(price(1490)).toBe('$1,490');
    expect(annualPrice(lite)).toBe(50);
    expect(annualPrice(starter)).toBe(190);
    expect(annualPrice(business)).toBe(1400);
    expect(annualPrice(free)).toBeNull();
  });

  it('includes $1 of usage on Free and the price on a paid plan without its own amount', () => {
    expect(includedUsage(free)).toBe(1);
    expect(includedUsage(lite)).toBe(5);
  });

  it("prefers the backend's own figures when it sends them", () => {
    expect(includedUsage({ ...free, includedUsage: 1 })).toBe(1);
    expect(annualPrice({ ...lite, annualPrice: 48 })).toBe(48);
    expect(annualPrice({ ...free, annualPrice: 0 })).toBeNull();
  });
});

describe('planLimits', () => {
  it('reads Free as 3 server apps, unlimited static sites, no databases, no domain', () => {
    expect(planLimits(free)).toBe(
      '3 server apps · unlimited static sites (20 GB/mo fair use) · sizes Nano/Micro · no databases · no always-on · no custom domains · Light Cloud badge on sites · ≤3 instances/app · 1 member'
    );
  });

  it('reads Lite as 5 apps of any kind and one shared database', () => {
    const limits = planLimits(lite);
    expect(limits).toContain('5 server apps');
    expect(limits).not.toContain('only');
    expect(limits).toContain('unlimited static sites (1 TB/mo fair use)');
    expect(limits).toContain('1 shared db');
    expect(limits).not.toContain('badge');
  });

  it('includes three members on Starter and sells no extra seats', () => {
    expect(planLimits(starter)).toContain('3 members');
    expect(planLimits(starter)).not.toContain('$9');
    expect(planLimits(business)).toContain('unlimited members');
  });
});

describe('refusal hints and pauses', () => {
  it('names the command, the plan and its price', () => {
    expect(requiredPlanHint({ id: 'lite', name: 'Lite', price: 5 })).toBe('Lite includes it ($5 a month): run `lc billing upgrade lite`.');
    expect(requiredPlanHint(null)).toContain('No plan includes more');
  });

  it('pauses server apps and deploys on Free, never static sites, never a bill', () => {
    const notice = pausedNotice(true, 1, '2026-11-03');
    expect(notice).toContain("Free's $1.00 of included usage is used up");
    expect(notice).toContain('paused until 2026-11-03');
    expect(notice).toContain('Static sites keep serving');
    expect(notice).toContain('never billed');
    expect(pausedNotice(false, 19)).toContain('usage limit');
  });

  it('takes the pause reason from the backend, else from the plan price', () => {
    expect(pausedOnFree('free_allowance', lite)).toBe(true);
    expect(pausedOnFree('usage_limit', free)).toBe(false);
    expect(pausedOnFree(undefined, free)).toBe(true);
  });

  it('describes the usage limit and a pending switch of billing interval', () => {
    expect(usageLimitNote({ extra: null, paused: false })).toBe('none (extra usage goes on the next invoice)');
    expect(usageLimitNote({ extra: 20, paused: true })).toBe('server apps and deploys pause after $20.00 of extra usage (reached this cycle)');
    expect(pendingIntervalNote('month')).toBe('Monthly billing starts when the paid year ends.');
    expect(pendingIntervalNote(undefined)).toBeNull();
  });
});
