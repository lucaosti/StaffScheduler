/**
 * The timeline: what it draws, and what it refuses to draw.
 *
 * Two things here are worth more than the plumbing. The first is that scoping
 * happens INSIDE each source's query — a row the caller may not see is never
 * read, so no later filter can be forgotten. The second is that an empty scope
 * means "nothing", not "everything": that is the direction in which a
 * misconfigured membership is visible rather than catastrophic.
 *
 * @author Luca Ostinelli
 */

import { TimelineService, TIMELINE_SOURCE_KEYS } from '../services/TimelineService';
import { ValidationError } from '../errors';

export {};

const makePool = () => {
  const execute = jest.fn().mockResolvedValue([[], []]);
  return { pool: { execute } as never, execute };
};

const shiftRow = (over: Record<string, unknown> = {}) => ({
  user_id: 4,
  user_name: 'Ada Lovelace',
  date: '2033-04-01',
  start_time: '09:00:00',
  end_time: '17:00:00',
  label: 'Ward A',
  status: 'confirmed',
  ...over,
});

const range = { from: '2033-04-01', to: '2033-04-07' };

describe('building a timeline', () => {
  it('turns rows into one lane per person and one bar per interval', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[shiftRow(), shiftRow({ date: '2033-04-02' })], []])
      .mockResolvedValueOnce([[], []]);

    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });

    expect(out.lanes).toEqual([{ id: '4', label: 'Ada Lovelace', kind: 'employee' }]);
    expect(out.bars).toHaveLength(2);
    expect(out.bars[0]).toMatchObject({ laneId: '4', label: 'Ward A', source: 'shifts' });
  });

  it('gives an overnight bar one interval ending the next morning', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[shiftRow({ start_time: '22:00:00', end_time: '06:00:00' })], []])
      .mockResolvedValueOnce([[], []]);

    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });

    // Naive rendering would end the bar before it began. The shared overnight
    // arithmetic is reused rather than re-derived: this rule has produced two
    // defects already in other readers.
    expect(out.bars[0].start).toBe('2033-04-01T22:00:00.000Z');
    expect(out.bars[0].end).toBe('2033-04-02T06:00:00.000Z');
  });

  it('formats a date the driver hands back as a Date', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[shiftRow({ date: new Date('2033-04-01T00:00:00Z') })], []])
      .mockResolvedValueOnce([[], []]);

    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });
    expect(out.bars[0].start).toBe('2033-04-01T09:00:00.000Z');
  });

  it('merges sources onto the same lane', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[shiftRow()], []])
      .mockResolvedValueOnce([
        [shiftRow({ label: 'On call — Ward A', start_time: '17:00:00', end_time: '22:00:00' })],
        [],
      ]);

    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });

    // One person, one lane, two kinds of bar. Seeing a shift and an on-call
    // period on the same row is the point of having more than one source.
    expect(out.lanes).toHaveLength(1);
    expect(out.bars.map((b) => b.source)).toEqual(['shifts', 'on-call']);
  });

  it('orders lanes by name so the chart does not jump between requests', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([
        [shiftRow({ user_id: 9, user_name: 'Zoe Byron' }), shiftRow({ user_id: 4, user_name: 'Ada Lovelace' })],
        [],
      ])
      .mockResolvedValueOnce([[], []]);

    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });
    expect(out.lanes.map((l) => l.label)).toEqual(['Ada Lovelace', 'Zoe Byron']);
  });
});

describe('scoping', () => {
  it('restricts inside the query rather than filtering afterwards', async () => {
    const { pool, execute } = makePool();
    await new TimelineService(pool).build({ ...range, orgUnitIds: [3, 5] });

    // A row the caller may not see is never read, so there is no later filter
    // to forget — and no accidental leak through a code path that skips it.
    for (const call of execute.mock.calls) {
      expect(String(call[0])).toContain('d.org_unit_id IN (3,5)');
    }
  });

  it('omits the restriction entirely for an unrestricted caller', async () => {
    const { pool, execute } = makePool();
    await new TimelineService(pool).build({ ...range, orgUnitIds: null });
    expect(String(execute.mock.calls[0][0])).not.toContain('org_unit_id IN');
  });

  it('returns nothing, and queries nothing, for an empty scope', async () => {
    const { pool, execute } = makePool();
    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: [] });

    // "Belongs to no unit" must mean nothing visible, not everything. It would
    // also produce `IN ()`, which is a syntax error rather than an empty
    // result — so the wrong reading fails loudly, but only if it gets that
    // far, and it must not.
    expect(out.lanes).toEqual([]);
    expect(out.bars).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('never selects pay, notes or absence reasons', async () => {
    const { pool, execute } = makePool();
    await new TimelineService(pool).build({ ...range, orgUnitIds: null });

    // Columns are listed explicitly rather than selected and trimmed, so a
    // column added to `users` later cannot appear here by omission.
    for (const call of execute.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toMatch(/SELECT \*/);
      expect(sql).not.toContain('hourly_rate');
      expect(sql).not.toContain('notes');
      expect(sql).not.toContain('user_unavailability');
      expect(sql).not.toContain('time_off_requests');
    }
  });
});

describe('source selection', () => {
  it('draws every source by default', async () => {
    const { pool, execute } = makePool();
    const out = await new TimelineService(pool).build({ ...range, orgUnitIds: null });
    expect(out.sources).toEqual(TIMELINE_SOURCE_KEYS);
    expect(execute).toHaveBeenCalledTimes(TIMELINE_SOURCE_KEYS.length);
  });

  it('queries only the sources asked for', async () => {
    const { pool, execute } = makePool();
    await new TimelineService(pool).build({ ...range, orgUnitIds: null, sources: ['on-call'] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toContain('on_call_assignments');
  });

  it('rejects an unknown source rather than silently drawing nothing', async () => {
    const { pool } = makePool();
    await expect(
      new TimelineService(pool).build({ ...range, orgUnitIds: null, sources: ['theatres'] })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('range limits', () => {
  it('refuses a range longer than a quarter', async () => {
    const { pool, execute } = makePool();
    await expect(
      new TimelineService(pool).build({ from: '2033-01-01', to: '2033-12-31', orgUnitIds: null })
    ).rejects.toThrow(/at most 92 days/);
    // Refused before any query: the bound is about how much work this makes
    // the database do.
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a range that ends before it starts', async () => {
    const { pool } = makePool();
    await expect(
      new TimelineService(pool).build({ from: '2033-04-07', to: '2033-04-01', orgUnitIds: null })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows exactly the maximum span', async () => {
    const { pool } = makePool();
    // The boundary itself must be usable, or the documented limit is a lie by
    // one day.
    await expect(
      new TimelineService(pool).build({ from: '2033-01-01', to: '2033-04-03', orgUnitIds: null })
    ).resolves.toBeDefined();
  });
});
