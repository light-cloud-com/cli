/**
 * How plans read in the terminal: names, prices and limits.
 *
 * Words follow docs/PRICING_VOCABULARY.md and the 2026-10-06 redesign
 * (docs/PRICING_REDESIGN.md): the free plan is "Free" (its id stays
 * `hobby`), a count of null means unlimited, and annual billing is two
 * months free.
 */

import type { PlanCatalogEntry } from '../api/light-cloud.js';

export const FREE_PLAN_ID = 'hobby';

export interface RequiredPlan {
  id: string;
  name: string;
  price: number;
}

/** The name people read: "Free" for the free plan whatever its row says. */
export function planName(plan: { id: string; name?: string | null }): string {
  if (plan.id === FREE_PLAN_ID) return 'Free';
  return plan.name || plan.id.charAt(0).toUpperCase() + plan.id.slice(1);
}

/** Usage amounts keep their cents: "$0.48 of $1.00". */
export const money = (value: number): string => `$${value.toFixed(2)}`;

/** Plan prices in whole dollars when they are whole: "$5", "$1,490". */
export function price(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const entitlementsOf = (plan: PlanCatalogEntry): Record<string, unknown> => plan.entitlements ?? {};

/** Usage the plan includes each cycle; a plan without its own amount includes its price. */
export function includedUsage(plan: PlanCatalogEntry): number {
  if (typeof plan.includedUsage === 'number') return plan.includedUsage;
  const credits = entitlementsOf(plan).usageCredits;
  return typeof credits === 'number' ? credits : plan.price;
}

/** Twelve months paid upfront: the backend's figure, else the row's, else two months free. Null on $0 plans. */
export function annualPrice(plan: PlanCatalogEntry): number | null {
  if (plan.price <= 0) return null;
  if (typeof plan.annualPrice === 'number' && plan.annualPrice > 0) return plan.annualPrice;
  const explicit = entitlementsOf(plan).annualPrice;
  return typeof explicit === 'number' && explicit > 0 ? explicit : plan.price * 10;
}

/** A switch between monthly and yearly billing that waits for the paid period, in words. */
export function pendingIntervalNote(pendingInterval?: string | null): string | null {
  if (pendingInterval === 'year') return 'Yearly billing starts at the next cycle.';
  if (pendingInterval === 'month') return 'Monthly billing starts when the paid year ends.';
  return null;
}

/** The optional usage limit of a paid plan, in words. */
export function usageLimitNote(limit: { extra: number | null; paused?: boolean } | undefined): string | null {
  if (!limit) return null;
  return limit.extra === null
    ? 'none (extra usage goes on the next invoice)'
    : `server apps and deploys pause after ${money(limit.extra)} of extra usage${limit.paused ? ' (reached this cycle)' : ''}`;
}

/** A plan by id or by name; "free" finds the free plan. */
export function findPlan(plans: PlanCatalogEntry[], ref: string): PlanCatalogEntry | undefined {
  const wanted = ref.trim().toLowerCase();
  return plans.find((plan) => plan.id === wanted || plan.name.toLowerCase() === wanted || planName(plan).toLowerCase() === wanted);
}

export function cheapestPaidPlan(plans: PlanCatalogEntry[]): PlanCatalogEntry | undefined {
  return plans.filter((plan) => plan.price > 0).sort((a, b) => a.price - b.price)[0];
}

const SIZE_NAMES: Record<string, string> = { nano: 'Nano', micro: 'Micro', small: 'Small', medium: 'Medium', large: 'Large' };
const KIND_NAMES: Record<string, string> = { static: 'static sites', ssr: 'server-rendered frontends', service: 'server apps' };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function bandwidth(gb: unknown): string {
  if (typeof gb !== 'number' || gb <= 0) return '';
  return ` (${gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`}/mo fair use)`;
}

function databases(ent: Record<string, unknown>): string {
  const tiers = Array.isArray(ent.databaseTiers) ? (ent.databaseTiers as string[]) : null;
  const count = typeof ent.databases === 'number' ? ent.databases : null;
  if (ent.databasesAllowed === false || count === 0 || tiers?.length === 0) return 'no databases';
  const counted = (noun: string) => (count === null ? `${noun}s` : plural(count, noun));
  if (tiers && !tiers.every((tier) => tier === 'shared-dev')) return `${counted('db')} on tiers ${tiers.join('/')}`;
  return counted(tiers ? 'shared db' : 'shared or dedicated db');
}

/** What a plan lets a workspace create, in words (its included usage is shown on its own). */
export function planLimits(plan: PlanCatalogEntry): string {
  const ent = entitlementsOf(plan);
  const parts: string[] = [];
  if (Array.isArray(ent.appKinds)) parts.push(`${(ent.appKinds as string[]).map((k) => KIND_NAMES[k] ?? k).join(' + ')} only`);
  parts.push(typeof ent.services === 'number' ? plural(ent.services, 'server app') : 'unlimited server apps');
  parts.push((typeof ent.sites === 'number' ? plural(ent.sites, 'static site') : 'unlimited static sites') + bandwidth(ent.staticBandwidthGb));
  parts.push(Array.isArray(ent.containerSizes) ? `sizes ${(ent.containerSizes as string[]).map((s) => SIZE_NAMES[s] ?? s).join('/')}` : 'every size');
  parts.push(databases(ent));
  parts.push(ent.alwaysOnAllowed ? 'always-on' : 'no always-on');
  parts.push(ent.customDomainsAllowed === false ? 'no custom domains' : 'custom domains');
  if (ent.brandingBadge === true || (ent.brandingBadge === undefined && plan.price === 0)) parts.push('Light Cloud badge on sites');
  if (typeof ent.maxInstances === 'number') parts.push(`≤${ent.maxInstances} instances/app`);
  if (ent.seats === null) parts.push('unlimited members');
  else if (typeof ent.seats === 'number') parts.push(plural(ent.seats, 'member'));
  return parts.join(' · ');
}

/**
 * The hint under a plan refusal: the command that moves to the plan the
 * refusal named, with its price. Null means no plan includes more.
 */
export function requiredPlanHint(plan: RequiredPlan | null): string {
  if (!plan) return 'No plan includes more of this. For a bigger setup, write to us with `lc support`.';
  return `${planName(plan)} includes it (${price(plan.price)} a month): run \`lc billing upgrade ${plan.id}\`.`;
}

/**
 * Why a paused workspace is paused: the backend says so since the redesign
 * ('free_allowance' or 'usage_limit'); before that only Free could pause.
 */
export function pausedOnFree(reason: string | null | undefined, plan: PlanCatalogEntry | undefined): boolean {
  if (reason === 'free_allowance') return true;
  if (reason === 'usage_limit') return false;
  return (plan?.price ?? 0) <= 0;
}

/**
 * What a paused workspace is told. Free pauses when its included usage is
 * used up; a paid plan only at a usage limit chosen at checkout. Server apps
 * and deploys stop; static sites never do.
 */
export function pausedNotice(onFree: boolean, included: number, resumesOn?: string | null): string {
  const until = resumesOn ? `until ${resumesOn}` : 'until the next cycle';
  return onFree
    ? `Free's ${money(included)} of included usage is used up, so server apps and deploys are paused ${until} or an upgrade. Static sites keep serving, and a free workspace is never billed.`
    : `This cycle's extra usage reached the workspace's usage limit, so server apps and deploys are paused ${until} or until the limit is raised. Static sites keep serving.`;
}
