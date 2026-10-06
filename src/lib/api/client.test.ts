import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import { ApiClient } from './client.js';

const client = new ApiClient({ apiUrl: 'https://api.test', consoleUrl: 'https://console.test', socketUrl: 'https://api.test' });

function answer(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
}

const refusal = async (): Promise<ApiError> => {
  const error = await client.post('/api/applications/create', {}, { anonymous: true }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plan refusals', () => {
  it('name the plan that includes what was refused', async () => {
    answer(403, {
      code: 'PLAN_ENTITLEMENT',
      message: 'The Free plan includes 3 server apps and this workspace already has 3.',
      nextStep: 'choose-plan',
      entitlement: 'server_apps',
      requiredPlan: { id: 'lite', name: 'Lite', price: 5 },
    });
    const error = await refusal();
    expect(error.code).toBe('PLAN_ENTITLEMENT');
    expect(error.hint).toBe('Lite includes it ($5 a month): run `lc billing upgrade lite`.');
  });

  it('say so when no plan includes more', async () => {
    answer(403, { code: 'PLAN_ENTITLEMENT', message: 'No plan includes more.', nextStep: 'choose-plan', requiredPlan: null });
    expect((await refusal()).hint).toContain('No plan includes more');
  });

  it('point at the plans when the backend names none', async () => {
    answer(402, { code: 'POOL_EXHAUSTED', message: 'Paused.', nextStep: 'choose-plan' });
    expect((await refusal()).hint).toBe('See the plans with `lc billing plans`, then upgrade with `lc billing upgrade <plan>`.');
  });

  it('explain a declined card', async () => {
    answer(402, { code: 'PAYMENT_FAILED', message: 'Your card was declined.' });
    expect((await refusal()).hint).toContain('lc billing card add');
  });
});
