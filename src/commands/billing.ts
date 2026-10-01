import type { Command } from 'commander';
import { ApiError, CancelledError, CliError, EXIT } from '../lib/errors.js';
import { openBrowser } from '../lib/open-browser.js';
import { c, emit, heading, isInteractive, link, log, out, printDetails, printTable } from '../lib/ui/output.js';
import { confirm, select, spinner } from '../lib/ui/prompts.js';
import { contextFrom } from './shared.js';

const money = (value: number) => `$${value.toFixed(2)}`;

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
      const current = plans.plans.find((plan) => plan.id === (plans.currentPlanId ?? 'hobby'));
      const card = summary?.data.payment_method ?? null;
      emit({ organisation: org, plan: current ?? null, pendingPlanId: plans.pendingPlanId, card, pool: plans.pool, hardStopped: plans.hardStopped }, () => {
        heading(org.name ?? org.id);
        printDetails([
          ['Plan', current ? `${c.bold(current.name)} ${c.dim(`(${current.id})`)} · ${money(current.price)}/month` : (plans.currentPlanId ?? 'free')],
          ['Pending', plans.pendingPlanId ? `${plans.pendingPlanId} at next cycle` : undefined],
          ['Card', card ? `${card.brand} •••• ${card.last4}` : `none ${c.dim('(lc billing card add)')}`],
          ['Usage', `${money(plans.pool.spent)} of ${money(plans.pool.total)} included (${Math.round((plans.pool.pct ?? 0) * 100)}%)${plans.pool.overage > 0 ? `, extra usage ${money(plans.pool.overage)} — goes on the next invoice` : ''}`],
          ['Next invoice', summary?.data.billing_cycle.next_billing_date?.slice(0, 10)],
        ]);
        if (plans.hardStopped) {
          out();
          log.warn("The free plan's included usage is used up — projects are paused until an upgrade (lc billing plan use <id>) or the next cycle.");
        }
      });
    });

  billing
    .command('plans')
    .description('Plans this workspace can be on')
    .action(async (_options: unknown, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const { data } = await ctx.api.plans(org.id);
      const currentId = data.currentPlanId ?? 'hobby';
      emit(data.plans, () => {
        printTable(data.plans, [
          { header: 'Plan', cell: (plan) => `${c.bold(plan.name)}${plan.id === currentId ? c.accent(' (current)') : ''}` },
          { header: 'ID', cell: (plan) => plan.id },
          { header: 'Price', cell: (plan) => `${money(plan.price)}/mo` },
          { header: 'Includes', cell: (plan) => summariseEntitlements(plan) },
        ]);
        out();
        out(c.dim('  Switch: lc billing plan use <id>   ·   paid plans need a card: lc billing card add'));
      });
    });

  const plan = billing.command('plan').description('Change plan');

  plan
    .command('use [plan]')
    .description('Put the workspace on a plan (no id: pick from a list)')
    .option('-y, --yes', 'skip the confirmation')
    .action(async (ref: string | undefined, options: { yes?: boolean }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();
      const { data } = await ctx.api.plans(org.id);
      const currentId = data.currentPlanId ?? 'hobby';

      let target = ref ? data.plans.find((p) => p.id === ref.toLowerCase() || p.name.toLowerCase() === ref.toLowerCase()) : undefined;
      if (ref && !target) {
        throw new CliError(`No plan called "${ref}".`, { hint: `Plans: ${data.plans.map((p) => p.id).join(', ')}.`, exitCode: EXIT.NOT_FOUND });
      }
      if (!target) {
        const chosen = await select<string>(
          'Which plan?',
          data.plans.map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}/mo`, hint: p.id === currentId ? 'current' : undefined })),
          { flag: 'lc billing plan use <id>', initialValue: currentId }
        );
        target = data.plans.find((p) => p.id === chosen)!;
      }

      const current = data.plans.find((p) => p.id === currentId);
      if (target.price > (current?.price ?? 0)) {
        const charge = (current?.price ?? 0) <= 0 ? target.price : undefined;
        const ok = await confirm(
          `Switch ${org.name ?? 'this workspace'} to ${target.name} (${money(target.price)}/month)?${charge !== undefined ? ` The card on file is charged ${money(charge)} now.` : ''}`,
          { yes: Boolean(options.yes), flag: '--yes' }
        );
        if (!ok) throw new CancelledError();
      }

      let result;
      try {
        result = await ctx.api.choosePlan(org.id, target.id);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'PAYMENT_METHOD_REQUIRED') {
          throw new CliError('A card is needed for a paid plan.', { hint: `Run ${c.bold('lc billing card add')}, then this command again.`, exitCode: EXIT.ERROR, code: error.code });
        }
        throw error;
      }
      emit(result.data, () => {
        if (result.data.pendingPlanId) {
          log.success(`Downgrade scheduled: ${result.data.planId} until ${result.data.effectiveAt?.slice(0, 10) ?? 'the next cycle'}, then ${result.data.pendingPlanId}.`);
        } else {
          const charge = result.data.proratedCharge > 0 ? ` Charged ${money(result.data.proratedCharge)} (${result.data.chargeStatus}).` : '';
          log.success(`${org.name ?? 'Workspace'} is now on ${c.bold(result.data.planId)}.${charge}`);
        }
      });
    });

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
        else log.info(`No card on file. Add one with ${c.bold('lc billing card add')}.`);
      });
    });

  card
    .command('add')
    .description('Save a card through a Stripe-hosted page (link you can open on any device)')
    .option('--no-browser', 'print the link instead of opening a browser')
    .option('--plan <id>', 'switch to this plan once the card is saved')
    .action(async (options: { browser: boolean; plan?: string }, command: Command) => {
      const ctx = contextFrom(command);
      const org = await ctx.resolveOrg();

      let session;
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

      const opened = options.browser && isInteractive() ? openBrowser(session.url) : false;
      out(`${c.dim('│')}  ${opened ? 'Browser opened. If nothing happened, open this link' : 'Open this link on any device to save a card'} ${c.dim('(Stripe-hosted; the card never passes through lc)')}:`);
      out(`${c.dim('│')}  ${link(session.url)}`);

      const spin = spinner();
      spin.start('Waiting for the card to be saved…');
      const deadline = new Date(session.expiresAt).getTime();
      let status: 'open' | 'complete' | 'expired' = 'open';
      let saved = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        try {
          const answer = (await ctx.api.checkoutSessionStatus(org.id, session.sessionId)).data;
          status = answer.status;
          if (status === 'complete') {
            saved = answer.paymentMethod;
            break;
          }
          if (status === 'expired') break;
        } catch {
          // transient; keep waiting until the link expires
        }
      }
      if (status !== 'complete') {
        spin.stop('No card saved', 1);
        throw new CliError(status === 'expired' ? 'The card setup link expired.' : 'The card setup link timed out.', { hint: 'Run `lc billing card add` again for a new link.' });
      }
      spin.stop(`Card saved${saved ? `: ${saved.brand} •••• ${saved.last4}` : ''}`);

      let planResult = null;
      if (options.plan) {
        planResult = (await ctx.api.choosePlan(org.id, options.plan)).data;
        log.success(`${org.name ?? 'Workspace'} is now on ${c.bold(planResult.planId)}${planResult.proratedCharge > 0 ? ` (charged ${money(planResult.proratedCharge)})` : ''}.`);
      }
      emit({ ok: true, card: saved, plan: planResult }, () => {
        if (!options.plan) out(c.dim('  Pick a plan with: lc billing plan use <id>'));
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

const SIZE_NAMES: Record<string, string> = { nano: 'Nano', micro: 'Micro', small: 'Small', medium: 'Medium', large: 'Large' };
const KIND_NAMES: Record<string, string> = { static: 'static sites', ssr: 'server-rendered frontends', service: 'server apps' };

/** What a plan includes and allows, in words: the usage first, then the limits. */
function summariseEntitlements(plan: { price: number; entitlements?: Record<string, unknown> | null }): string {
  const ent = plan.entitlements ?? {};
  const included = typeof ent.usageCredits === 'number' ? ent.usageCredits : plan.price;
  const parts: string[] = [`${money(included)} of usage a month`];
  if (Array.isArray(ent.appKinds)) parts.push(`${(ent.appKinds as string[]).map((k) => KIND_NAMES[k] ?? k).join(' + ')} only`);
  const counts: string[] = [];
  if (typeof ent.services === 'number') counts.push(`${ent.services} server app${ent.services === 1 ? '' : 's'}`);
  if (typeof ent.sites === 'number') counts.push(`${ent.sites} site${ent.sites === 1 ? '' : 's'}`);
  if (counts.length) parts.push(counts.join(', '));
  parts.push(Array.isArray(ent.containerSizes) ? `sizes ${(ent.containerSizes as string[]).map((s) => SIZE_NAMES[s] ?? s).join('/')}` : 'every size');
  if (Array.isArray(ent.databaseTiers)) {
    const tiers = ent.databaseTiers as string[];
    parts.push(tiers.length ? `db tiers ${tiers.join('/')}` : 'no databases');
  } else parts.push('every db tier');
  parts.push(ent.alwaysOnAllowed ? 'always-on' : 'no always-on');
  parts.push(ent.customDomainsAllowed === false ? 'no custom domains' : 'custom domains');
  if (ent.brandingBadge === true || (ent.brandingBadge === undefined && plan.price === 0)) parts.push('Light Cloud badge on sites');
  if (typeof ent.maxInstances === 'number') parts.push(`≤${ent.maxInstances} instances/app`);
  if (ent.seats === null) parts.push('unlimited members');
  else if (typeof ent.seats === 'number') parts.push(`${ent.seats} member${ent.seats === 1 ? '' : 's'}${ent.extraSeatAllowed ? ' (+$9 each extra)' : ''}`);
  return parts.join(' · ');
}
