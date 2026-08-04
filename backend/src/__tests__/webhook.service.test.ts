/**
 * WebhookService unit tests.
 */

import { WebhookService, signPayload } from '../services/WebhookService';

type Tuple = [unknown, unknown];

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  organization_name: 'Acme',
  url: 'https://example.com/hook',
  event_types: 'schedule.published,assignment.confirmed',
  is_active: 1,
  created_at: 'x',
  ...overrides,
});

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('WebhookService.listForOrganization', () => {
  it('maps rows into WebhookSubscription objects', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);

    const [sub] = await new WebhookService(pool).listForOrganization('Acme');

    expect(sub).toEqual({
      id: 1,
      organizationName: 'Acme',
      url: 'https://example.com/hook',
      eventTypes: ['schedule.published', 'assignment.confirmed'],
      isActive: true,
      createdAt: 'x',
    });
  });
});

describe('WebhookService.create', () => {
  it('issues a random secret and returns it alongside the created subscription', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ id: 5 })], null] as Tuple);

    const { subscription, secret } = await new WebhookService(pool).create(
      'Acme',
      { url: 'https://example.com/hook', eventTypes: ['schedule.published'] },
      1
    );

    expect(subscription.id).toBe(5);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const insertParams = execute.mock.calls[0][1];
    expect(insertParams[0]).toBe('Acme');
    expect(insertParams[1]).toBe('https://example.com/hook');
    expect(insertParams[2]).toBe(secret); // stored raw, not hashed — see the service header
    expect(insertParams[3]).toBe('schedule.published');
    expect(insertParams[4]).toBe(1);
  });

  it('throws if the row cannot be re-read right after insert', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ insertId: 5 }, null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple); // getById finds nothing

    await expect(
      new WebhookService(pool).create('Acme', { url: 'https://example.com/hook', eventTypes: ['schedule.published'] }, 1)
    ).rejects.toThrow('Failed to retrieve created webhook subscription');
  });
});

describe('WebhookService.update', () => {
  it('updates only the fields given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ is_active: 0 })], null] as Tuple);

    await new WebhookService(pool).update(1, { isActive: false });

    expect(execute.mock.calls[0][0]).toMatch(/is_active = \?/);
    expect(execute.mock.calls[0][0]).not.toMatch(/url = \?/);
    expect(execute.mock.calls[0][1]).toEqual([0, 1]);
  });

  it('reactivates a subscription', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow({ is_active: 1 })], null] as Tuple);

    await new WebhookService(pool).update(1, { isActive: true });

    expect(execute.mock.calls[0][1]).toEqual([1, 1]);
  });

  it('updates the url and eventTypes when given', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple)
      .mockResolvedValueOnce([[buildRow()], null] as Tuple);

    await new WebhookService(pool).update(1, {
      url: 'https://example.com/new-hook',
      eventTypes: ['assignment.confirmed'],
    });

    expect(execute.mock.calls[0][0]).toMatch(/url = \?/);
    expect(execute.mock.calls[0][0]).toMatch(/event_types = \?/);
    expect(execute.mock.calls[0][1]).toEqual(['https://example.com/new-hook', 'assignment.confirmed', 1]);
  });

  it('short-circuits to a plain read when no fields are given', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[buildRow()], null] as Tuple);

    const result = await new WebhookService(pool).update(1, {});

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatch(/SELECT \*/);
    expect(result?.id).toBe(1);
  });
});

describe('WebhookService.delete', () => {
  it('deletes by id', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, null] as Tuple);

    await new WebhookService(pool).delete(7);

    expect(execute.mock.calls[0][1]).toEqual([7]);
  });
});

describe('WebhookService.listDeliveries', () => {
  it('caps the limit to [1, 200]', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    await new WebhookService(pool).listDeliveries(1, 9999);

    expect(execute.mock.calls[0][0]).toMatch(/LIMIT 200/);
  });

  it('defaults to 50', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    await new WebhookService(pool).listDeliveries(1);

    expect(execute.mock.calls[0][0]).toMatch(/LIMIT 50/);
  });
});

describe('WebhookService.dispatch', () => {
  it('enqueues one delivery per active subscription matching the event type', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [
          { id: 1, event_types: 'schedule.published,assignment.confirmed' },
          { id: 2, event_types: 'assignment.confirmed' },
        ],
        null,
      ] as Tuple)
      .mockResolvedValueOnce([{ insertId: 10 }, null] as Tuple);

    await new WebhookService(pool).dispatch('Acme', 'schedule.published', { scheduleId: 1 });

    // Only subscription 1 matches 'schedule.published'.
    expect(execute).toHaveBeenCalledTimes(2);
    const insertCall = execute.mock.calls[1];
    expect(insertCall[1][0]).toBe(1);
    expect(insertCall[1][1]).toBe('schedule.published');
    expect(JSON.parse(insertCall[1][2])).toEqual({ scheduleId: 1 });
  });

  it('does nothing when no active subscription matches the event type', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[{ id: 2, event_types: 'assignment.confirmed' }], null] as Tuple);

    await new WebhookService(pool).dispatch('Acme', 'schedule.published', {});

    expect(execute).toHaveBeenCalledTimes(1); // only the SELECT — no INSERT
  });

  it('only looks up subscriptions for the given organization', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple);

    await new WebhookService(pool).dispatch('Acme', 'schedule.published', {});

    expect(execute.mock.calls[0][1]).toEqual(['Acme']);
    expect(execute.mock.calls[0][0]).toMatch(/is_active = TRUE/);
  });
});

describe('signPayload', () => {
  it('produces a deterministic sha256= prefixed HMAC', () => {
    const sig1 = signPayload('secret', '{"a":1}');
    const sig2 = signPayload('secret', '{"a":1}');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('produces different signatures for different secrets or bodies', () => {
    const base = signPayload('secret', '{"a":1}');
    expect(signPayload('other-secret', '{"a":1}')).not.toBe(base);
    expect(signPayload('secret', '{"a":2}')).not.toBe(base);
  });
});
