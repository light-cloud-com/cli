import type { Command } from 'commander';
import type {
  BillingInterval,
  CheckoutSession,
  CheckoutStatus,
  PlanCatalogEntry,
  UpgradeResult,
} from '../lib/api/light-cloud.js';
import {
  FREE_PLAN_ID,
  annualPrice,
  cheapestPaidPlan,
  findPlan,
  includedUsage,
  money,
  pausedNotice,
  pausedOnFree,
  pendingIntervalNote,
  planLimits,
  planName,
  price,
  usageLimitNote,
} from '../lib/billing/plans.js';
import type { Context } from '../lib/context.js';
import { ApiError, CancelledError, CliError, EXIT } from '../lib/errors.js';
import { openBrowser } from '../lib/open-browser.js';
import { c, emit, heading, isInteractive, isJson, link, log, out, printDetails, printTable } from '../lib/ui/output.js';
import { confirm, select, spinner } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

/** "$5/month", or "$0, no card" for Free. */
const priceLabel = (plan: PlanCatalogEntry): string => (plan.price > 0 ? `${price(plan.price)}/month` : '$0, no card');

/**
 * Billing from the terminal: what the workspace is on, what it could be on,
 * and the one thing that needs a browser — the card, through a Stripe-hosted
 * page the person opens anywhere (a phone will do). No card number ever
 * touches the CLI.
 */
export function registerBillingCommands(program: Command): void {
  const billing = program.command('billing').description('Plan, included usage and payment card for a workspace');

  billing
    .command('show', { isDefault: true })
    .description('Plan, card on file and usage this cycle against what the plan includes')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const [{ data: plans }, summary] = await Promise.all([
        ctx.api.plans(org.id),
        ctx.api.ownerBillingSummary().catch(() => null),
      ]);
      const currentId = plans.currentPlanId ?? FREE_PLAN_ID;
      const current = plans.plans.find((plan) => plan.id === currentId);
      const onFree = (current?.price ?? 0) <= 0;
      const yearly = current && plans.interval === 'year' ? annualPrice(current) : null;
      const nameOf = (id: string) => planName(plans.plans.find((plan) => plan.id === id) ?? { id });
      const pending = [plans.pendingPlanId ? `${nameOf(plans.pendingPlanId)} at next cycle.` : null, pendingIntervalNote(plans.pendingInterval)].filter(Boolean).join(' ');
      const limit = onFree ? null : usageLimitNote(plans.usageLimit);
      const stoppedOnFree = pausedOnFree(plans.hardStopReason, current);
      const card = summary?.data.payment_method ?? null;
      const cycleEnd = summary?.data.billing_cycle.next_billing_date?.slice(0, 10);
      emit({
        organisation: org,
        plan: current ?? null,
        pendingPlanId: plans.pendingPlanId,
        interval: plans.interval ?? 'month',
        pendingInterval: plans.pendingInterval ?? null,
        card,
        pool: plans.pool,
        usageLimit: plans.usageLimit ?? null,
        hardStopped: plans.hardStopped,
        hardStopReason: plans.hardStopReason ?? null,
      }, () => {
        heading(org.name ?? org.id);
        printDetails([
          ['Plan', current ? `${c.bold(planName(current))} ${c.dim(`(${current.id})`)} · ${yearly ? `${price(yearly)}/year${plans.annualPaidUntil ? `, paid until ${plans.annualPaidUntil.slice(0, 10)}` : ''}` : priceLabel(current)}` : nameOf(currentId)],
          ['Pending', pending || undefined],
          ['Card', card ? `${card.brand} •••• ${card.last4}` : onFree ? `none ${c.dim('(Free needs no card)')}` : `none ${c.dim('(lc billing card add)')}`],
          ['Usage', `${money(plans.pool.spent)} of ${money(plans.pool.total)} included (${Math.round((plans.pool.pct ?? 0) * 100)}%)${plans.pool.overage > 0 ? `, extra usage ${money(plans.pool.overage)} — goes on the next invoice` : ''}`],
          ['Usage limit', limit ?? undefined],
          [onFree ? 'Usage resets' : 'Next invoice', cycleEnd],
        ]);
        if (plans.hardStopped) {
          out();
          log.warn(pausedNotice(stoppedOnFree, plans.pool.total, cycleEnd));
          const next = stoppedOnFree ? cheapestPaidPlan(plans.plans) : undefined;
          if (next) {
            log.info(`${planName(next)} brings them back within minutes: ${price(next.price)} a month with ${money(includedUsage(next))} of usage included. Run ${c.bold(`lc billing upgrade ${next.id}`)}.`);
          }
        }
      });
    });

  billing
    .command('plans')
    .description('Plans this workspace can be on: monthly and annual price, included usage, limits')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const { data } = await ctx.api.plans(org.id);
      const currentId = data.currentPlanId ?? FREE_PLAN_ID;
      emit(data.plans, () => {
        printTable(data.plans, [
          { header: 'Plan', cell: (plan) => `${c.bold(planName(plan))}${plan.id === currentId ? c.accent(' (current)') : ''}` },
          { header: 'ID', cell: (plan) => plan.id },
          { header: 'Monthly', cell: (plan) => (plan.price > 0 ? `${price(plan.price)}/mo` : '$0'), align: 'right' },
          { header: 'Annual', cell: (plan) => { const yearly = annualPrice(plan); return yearly ? `${price(yearly)}/yr` : c.dim('—'); }, align: 'right' },
          { header: 'Included usage', cell: (plan) => `${money(includedUsage(plan))}/mo`, align: 'right' },
        ]);
        out();
        // Limits in full under the table: a table cell is cut at half the terminal width.
        const width = Math.max(...data.plans.map((plan) => planName(plan).length));
        for (const plan of data.plans) out(`  ${c.bold(planName(plan).padEnd(width))}  ${planLimits(plan)}`);
        out();
        out(c.dim('  Annual billing is two months free. Free needs no card and never bills you: when its usage is used up, server apps and deploys pause and static sites keep serving.'));
        out(c.dim('  Upgrade: lc billing upgrade <id> [--annual]   ·   one Stripe Checkout takes the card and the first payment'));
      });
    });

  const changePlanOptions = (cmd: Command): Command =>
    cmd
      .option('--annual', 'bill a year upfront (two months free)')
      .option('--no-browser', 'print the Stripe link instead of opening a browser')
      .option('-y, --yes', 'skip the confirmation')
      .action(changePlan);

  changePlanOptions(
    billing
      .command('upgrade [plan]')
      .description('Move to a plan in one step: charges the card on file, or opens Stripe Checkout for the card and the first payment')
  );

  const plan = billing.command('plan').description('Change plan');
  changePlanOptions(
    plan
      .command('use [plan]')
      .description('Put the workspace on a plan (no id: pick from a list); the same as lc billing upgrade, downgrades included')
  );

  const card = billing.command('card').description('Payment card');

  card
    .command('show', { isDefault: true })
    .description('The card on file')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const summary = await ctx.api.ownerBillingSummary();
      const method = summary.data.payment_method;
      emit({ card: method }, () => {
        if (method) log.info(`${method.brand} •••• ${method.last4}`);
        else log.info(`No card on file. Free needs none; ${c.bold('lc billing upgrade <plan>')} asks for one when you upgrade.`);
      });
    });

  card
    .command('add')
    .description('Save or replace the card through a Stripe-hosted page (a link you can open on any device)')
    .option('--no-browser', 'print the link instead of opening a browser')
    .option('--plan <id>', 'switch to this plan once the card is saved')
    .action(async (options: { browser: boolean; plan?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();

      // Check the plan before the person goes through Stripe, not after.
      let catalogue: PlanCatalogEntry[] = [];
      let target: PlanCatalogEntry | undefined;
      if (options.plan) {
        catalogue = (await ctx.api.plans(org.id)).data.plans;
        target = findPlan(catalogue, options.plan);
        if (!target) {
          throw new CliError(`No plan called "${options.plan}".`, { hint: `Plans: ${catalogue.map((p) => p.id).join(', ')}.`, exitCode: EXIT.NOT_FOUND });
        }
      }

      let session: CheckoutSession;
      try {
        session = (await ctx.api.createCheckoutSession(org.id)).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          throw new CliError('Hosted card setup is not enabled on this Light Cloud environment.', {
            hint: 'Add a card in the console under Billing → General.',
            exitCode: EXIT.ERROR,
          });
        }
        throw error;
      }

      const result = await followCheckout(ctx, org.id, session, { browser: options.browser, purpose: 'card' });
      if (result.status !== 'complete') {
        throw new CliError(result.status === 'expired' ? 'The card setup link expired.' : 'The card setup link timed out.', { hint: 'Run `lc billing card add` again for a new link.' });
      }

      const planResult = target ? await applyPlan(ctx, org.id, target.id, undefined, options.browser) : null;
      emit({ ok: true, card: result.paymentMethod, plan: planResult }, () => {
        if (planResult) reportPlanChange(org.name ?? 'Workspace', planResult, catalogue);
        else out(c.dim('  Upgrade with: lc billing upgrade <plan>'));
      });
    });

  card
    .command('remove')
    .description('Remove the card on file')
    .option('-y, --yes', 'skip the confirmation')
    .action(async (options: { yes?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const ok = await confirm('Remove the card on file? Paid plans cannot be charged without one.', { yes: Boolean(options.yes), flag: '--yes' });
      if (!ok) throw new CancelledError();
      await ctx.api.removePaymentMethod(org.id);
      emit({ ok: true }, () => log.success('Card removed.'));
    });
}

/** `lc billing upgrade [plan]` and `lc billing plan use [plan]`. */
async function changePlan(ref: string | undefined, options: { annual?: boolean; browser: boolean }, command: Command): Promise<void> {
  const ctx = contextFrom(command);
  const org = await ctx.resolveOrg();
  const [{ data }, summary] = await Promise.all([ctx.api.plans(org.id), ctx.api.ownerBillingSummary().catch(() => null)]);
  const currentId = data.currentPlanId ?? FREE_PLAN_ID;

  let target = ref ? findPlan(data.plans, ref) : undefined;
  if (ref && !target) {
    throw new CliError(`No plan called "${ref}".`, { hint: `Plans: ${data.plans.map((p) => p.id).join(', ')}.`, exitCode: EXIT.NOT_FOUND });
  }
  if (!target) {
    const chosen = await select<string>(
      'Which plan?',
      data.plans.map((p) => ({ value: p.id, label: `${planName(p)} — ${priceLabel(p)}`, hint: p.id === currentId ? 'current' : undefined })),
      { flag: 'lc billing upgrade <plan>', initialValue: currentId }
    );
    target = data.plans.find((p) => p.id === chosen)!;
  }
  if (options.annual && target.price <= 0) {
    throw new CliError(`${planName(target)} has no annual billing.`, { hint: 'Leave out --annual.', exitCode: EXIT.USAGE });
  }

  // Confirm whenever money moves, now or as yearly billing later, saying how much and when.
  const terms = chargeTerms({
    target,
    fromPrice: data.plans.find((p) => p.id === currentId)?.price ?? 0,
    currentInterval: data.interval ?? 'month',
    annual: options.annual === true,
    card: summary?.data.payment_method ?? null,
  });
  if (terms) {
    // Without --annual the backend keeps the workspace's current billing interval.
    const yearly = options.annual || data.interval === 'year' ? annualPrice(target) : null;
    const headline = yearly !== null ? `${planName(target)}, billed yearly (${price(yearly)} a year)` : `${planName(target)} (${price(target.price)} a month)`;
    const ok = await confirm(`Move ${org.name ?? 'this workspace'} to ${headline}? ${terms}`, { yes: ctx.yes, flag: '--yes' });
    if (!ok) throw new CancelledError();
  }

  const outcome = await applyPlan(ctx, org.id, target.id, options.annual ? 'year' : undefined, options.browser);
  emit(outcome, () => reportPlanChange(org.name ?? 'Workspace', outcome, data.plans));
}

/**
 * What a plan change takes from the card and when, the way the backend's
 * plan switch charges it: from Free the first month (or year) now; between
 * paid plans the difference for the rest of the paid period now, with a
 * switch to yearly billing at the next cycle. Null when nothing is charged.
 */
function chargeTerms(p: {
  target: PlanCatalogEntry;
  fromPrice: number;
  currentInterval: BillingInterval;
  annual: boolean;
  card: { brand: string; last4: string } | null;
}): string | null {
  if (p.target.price <= 0) return null;
  const yearly = p.annual ? annualPrice(p.target) : null;
  if (p.fromPrice <= 0) {
    const first = price(yearly ?? p.target.price);
    return p.card
      ? `Your card on file (${p.card.brand} •••• ${p.card.last4}) is charged ${first} now.`
      : `Stripe Checkout takes your card and the first payment (${first}) together.`;
  }
  const yearlyLater = yearly !== null && p.currentInterval !== 'year' ? ` Yearly billing (${price(yearly)} a year) starts at the next cycle.` : '';
  if (p.target.price > p.fromPrice) {
    return p.currentInterval === 'year'
      ? 'The difference in yearly price for the rest of the paid year is charged to your card on file now.'
      : `The difference for the rest of this month is charged to your card on file now.${yearlyLater}`;
  }
  return yearlyLater ? `Nothing is charged now.${yearlyLater}` : null;
}

type PlanOutcome =
  | Extract<UpgradeResult, { status: 'done' }>
  | { status: 'checkout'; planId: string; interval: BillingInterval | null; applied: boolean | null; card: CheckoutStatus['paymentMethod'] };

/**
 * Moves the workspace to a plan: /billing/upgrade charges a saved card, or
 * answers with a Stripe Checkout page that takes the card and the first
 * payment, and the switch lands when Stripe confirms. A backend without the
 * route (404) gets the older choose-plan, which needs a saved card first;
 * annual billing exists only on the new route and is never retried monthly.
 */
async function applyPlan(ctx: Context, organisationId: string, planId: string, interval: BillingInterval | undefined, browser: boolean): Promise<PlanOutcome> {
  let answer: UpgradeResult;
  try {
    answer = (await ctx.api.upgradePlan(organisationId, planId, interval)).data;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status !== 404) throw planError(error, planId);
    if (interval === 'year') {
      throw new CliError('Annual billing is not available on this Light Cloud environment yet. Nothing was changed.', {
        hint: 'Run the command again without --annual for monthly billing.',
        code: 'ANNUAL_UNAVAILABLE',
      });
    }
    try {
      answer = { status: 'done', ...(await ctx.api.choosePlan(organisationId, planId)).data };
    } catch (legacyError) {
      throw legacyError instanceof ApiError ? planError(legacyError, planId) : legacyError;
    }
  }
  if (answer.status === 'done') return answer;

  const result = await followCheckout(ctx, organisationId, answer, { browser, purpose: 'upgrade' });
  if (result.status === 'expired') {
    throw new CliError('The Stripe link expired before it was completed. Nothing was charged and the plan is unchanged.', {
      hint: `Run \`lc billing upgrade ${planId}\` again for a new link.`,
    });
  }
  if (result.status === 'open') {
    throw new CliError('Stripe has not confirmed the payment.', {
      hint: `If you finished paying, \`lc billing\` shows the new plan within a few minutes; otherwise run \`lc billing upgrade ${planId}\` again.`,
    });
  }
  return {
    status: 'checkout',
    planId: result.plan?.id ?? planId,
    interval: interval ?? null,
    applied: result.plan ? result.plan.applied : null,
    card: result.paymentMethod,
  };
}

/** Plan-change refusals with a better way forward than the generic hint. */
function planError(error: ApiError, planId: string): CliError {
  if (error.code === 'PAYMENT_FAILED') {
    return new CliError(error.message, { hint: `To pay with a different card: \`lc billing card add --plan ${planId}\`.`, code: error.code });
  }
  if (error.code === 'PAYMENT_METHOD_REQUIRED') {
    return new CliError('A card is needed for a paid plan.', { hint: `Save one and switch in one go: \`lc billing card add --plan ${planId}\`.`, code: error.code });
  }
  return error;
}

/**
 * Hands the person a Stripe-hosted page (opened here, or a link for any
 * device) and waits for Stripe's answer. For an upgrade, done means the plan
 * has switched, not only that the payment went through; a switch that has
 * not landed two minutes after the payment ends the wait.
 */
async function followCheckout(
  ctx: Context,
  organisationId: string,
  session: CheckoutSession,
  options: { browser: boolean; purpose: 'upgrade' | 'card' }
): Promise<CheckoutStatus> {
  const upgrade = options.purpose === 'upgrade';
  const ask = upgrade ? 'Open this link to add a card; the plan switches as soon as Stripe confirms' : 'Open this link on any device to save a card';
  const opened = options.browser && isInteractive() ? openBrowser(session.url) : false;
  out(`${c.dim('│')}  ${opened ? 'Browser opened. If nothing happened, open this link' : ask} ${c.dim('(Stripe-hosted; the card never passes through lc)')}:`);
  out(`${c.dim('│')}  ${link(session.url)}`);
  // With --json, `out` is silent until the final document — but the link is needed now.
  if (isJson()) process.stderr.write(`${ask}: ${session.url}\n`);

  const spin = spinner();
  spin.start(upgrade ? 'Waiting for Stripe to confirm…' : 'Waiting for the card to be saved…');
  const expiresAt = new Date(session.expiresAt).getTime();
  let deadline = expiresAt;
  let last: CheckoutStatus = { status: 'open', paymentMethod: null };
  // The checkout-session route answers 404 while hosted card setup is off; the upgrade route reads the same session.
  let read = (id: string) => ctx.api.checkoutSessionStatus(organisationId, id);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      last = (await read(session.sessionId)).data;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) read = (id) => ctx.api.upgradeStatus(organisationId, id);
      continue; // transient; keep waiting until the link expires
    }
    if (last.status === 'expired') break;
    if (last.status === 'complete') {
      if (!last.plan || last.plan.applied) break;
      if (deadline === expiresAt) {
        deadline = Date.now() + 120_000;
        spin.message('Payment confirmed; switching the plan…');
      }
    }
  }

  const card = last.paymentMethod ? `${last.paymentMethod.brand} •••• ${last.paymentMethod.last4}` : null;
  if (last.status === 'complete') spin.stop(upgrade ? `Stripe confirmed${card ? ` (card ${card} saved)` : ''}` : `Card saved${card ? `: ${card}` : ''}`);
  else spin.stop(last.status === 'expired' ? 'The link expired' : 'No answer from Stripe', 1);
  return last;
}

/** What an upgrade took from the card, if anything. */
function chargeNote(r: { proratedCharge: number; chargeStatus: string; chargeKind?: string }): string {
  if (!(r.proratedCharge > 0)) return '';
  const what =
    r.chargeKind === 'prorated' ? ' for the rest of the paid period'
      : r.chargeKind === 'first_month' ? ' for the first month'
        : r.chargeKind === 'first_year' ? ' for the first year'
          : '';
  return ` Charged ${money(r.proratedCharge)}${what}${r.chargeStatus === 'paid' ? '' : ` (${r.chargeStatus})`}.`;
}

function reportPlanChange(workspace: string, outcome: PlanOutcome, plans: PlanCatalogEntry[]): void {
  const nameOf = (id: string) => planName(plans.find((plan) => plan.id === id) ?? { id });
  const billed = outcome.interval === 'year' ? ', billed yearly' : '';
  if (outcome.status === 'checkout') {
    if (outcome.applied === false) {
      log.warn(`Stripe confirmed the payment; the switch to ${nameOf(outcome.planId)} is still being applied. Check \`lc billing\` in a minute.`);
    } else if (outcome.applied === null) {
      log.success(`Stripe confirmed. ${workspace} moves to ${nameOf(outcome.planId)} within a minute; \`lc billing\` shows it.`);
    } else {
      log.success(`${workspace} is now on ${c.bold(nameOf(outcome.planId))}${billed}.`);
    }
    return;
  }
  const later = pendingIntervalNote(outcome.pendingInterval);
  const tail = later ? ` ${later}` : '';
  if (outcome.pendingPlanId) {
    log.success(`Downgrade scheduled: ${nameOf(outcome.planId)} until ${outcome.effectiveAt?.slice(0, 10) ?? 'the end of the paid period'}, then ${nameOf(outcome.pendingPlanId)}.${tail}`);
    return;
  }
  log.success(`${workspace} is now on ${c.bold(nameOf(outcome.planId))}${billed}.${chargeNote(outcome)}${tail}`);
}
