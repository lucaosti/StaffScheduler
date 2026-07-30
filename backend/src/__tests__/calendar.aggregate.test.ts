/**
 * The filtered aggregate calendar feed.
 *
 * A feed URL is a CREDENTIAL that lives as long as the subscription, so the
 * cases with weight are all about the scope: that it is resolved from the
 * token's owner on every fetch rather than baked into the URL, that a caller
 * cannot widen it through the filters, and that a scope resolving to nothing
 * returns nothing rather than everything — the classic way an empty-list check
 * turns a restriction into its opposite.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const resolveToken = jest.fn();
const buildAggregateFeed = jest.fn();
jest.mock('../services/CalendarService', () => ({
  CalendarService: jest.fn().mockImplementation(() => ({
    resolveToken,
    buildAggregateFeed,
    buildUserFeed: jest.fn(),
    buildDepartmentFeed: jest.fn(),
    listTokens: jest.fn(),
  })),
}));

const getEffectivePermissions = jest.fn();
const getUserRoles = jest.fn();
const computeAllowedOrgUnitIds = jest.fn();
const getUserOrgUnitSubtreeIds = jest.fn();
jest.mock('../services/RbacService', () => ({
  RbacService: jest.fn().mockImplementation(() => ({
    getEffectivePermissions,
    getUserRoles,
    computeAllowedOrgUnitIds,
    getUserOrgUnitSubtreeIds,
  })),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mount = () => {
  const { createCalendarRouter } = require('../routes/calendar');
  const app = express();
  app.use(express.json());
  app.use('/api/calendar', createCalendarRouter({ execute: jest.fn() } as never));
  return app;
};

const get = (query: string) => request(mount()).get(`/api/calendar/aggregate.ics${query}`);

beforeEach(() => {
  jest.clearAllMocks();
  resolveToken.mockResolvedValue(42);
  getEffectivePermissions.mockResolvedValue(['timeline.read']);
  getUserRoles.mockResolvedValue([]);
  computeAllowedOrgUnitIds.mockResolvedValue(null);
  getUserOrgUnitSubtreeIds.mockResolvedValue([3, 4]);
  buildAggregateFeed.mockResolvedValue({ body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', etag: '"abc"' });
});

describe('authentication', () => {
  it('refuses without a token', async () => {
    const res = await get('');
    expect(res.status).toBe(401);
    expect(buildAggregateFeed).not.toHaveBeenCalled();
  });

  it('refuses an unknown token', async () => {
    resolveToken.mockResolvedValue(null);
    const res = await get('?token=nope');
    expect(res.status).toBe(401);
  });

  it('refuses an owner who may not see other people\'s schedules', async () => {
    getEffectivePermissions.mockResolvedValue(['schedule.read']);
    const res = await get('?token=t');
    // Reusing the timeline codes rather than inventing a rule: this feed makes
    // the same disclosure, and two rules for one disclosure come to disagree.
    expect(res.status).toBe(403);
    expect(buildAggregateFeed).not.toHaveBeenCalled();
  });
});

describe('the scope, resolved per fetch', () => {
  it('is read from the token owner every time, not from the URL', async () => {
    await get('?token=t');
    // The URL carries no scope at all: a feed made while someone managed a ward
    // must stop publishing it when they stop.
    expect(getEffectivePermissions).toHaveBeenCalledWith(42);
    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({ visibleOrgUnitIds: [3, 4] })
    );
  });

  it('is unrestricted for an owner holding read_all with no role scope', async () => {
    getEffectivePermissions.mockResolvedValue(['timeline.read_all']);
    computeAllowedOrgUnitIds.mockResolvedValue(null);
    await get('?token=t');

    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({ visibleOrgUnitIds: null })
    );
  });

  it('keeps the ROLE scope binding even with read_all', async () => {
    getEffectivePermissions.mockResolvedValue(['timeline.read_all']);
    computeAllowedOrgUnitIds.mockResolvedValue([9]);
    await get('?token=t');

    // read_all lifts the membership bound, never the role scope — otherwise a
    // manager scoped to one ward would see every other ward's people.
    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({ visibleOrgUnitIds: [9] })
    );
    expect(getUserOrgUnitSubtreeIds).not.toHaveBeenCalled();
  });

  it('intersects membership with the role scope for an ordinary reader', async () => {
    getEffectivePermissions.mockResolvedValue(['timeline.read']);
    getUserOrgUnitSubtreeIds.mockResolvedValue([3, 4, 5]);
    computeAllowedOrgUnitIds.mockResolvedValue([4, 5, 6]);
    await get('?token=t');

    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({ visibleOrgUnitIds: [4, 5] })
    );
  });
});

describe('the filters', () => {
  it('parses comma-separated id lists into numbers', async () => {
    await get('?token=t&departmentId=3,4&roleId=2&userId=7,8,9');

    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentIds: [3, 4],
        roleIds: [2],
        userIds: [7, 8, 9],
      })
    );
  });

  it('rejects a malformed list instead of turning it into NaN', async () => {
    // `.split(',').map(Number)` on "3,abc" yields [3, NaN], and NaN in a query
    // silently matches nothing — a filter that quietly loses half its terms.
    const res = await get('?token=t&departmentId=3,abc');
    expect(res.status).toBe(400);
    expect(buildAggregateFeed).not.toHaveBeenCalled();
  });

  it('rejects a zero id', async () => {
    const res = await get('?token=t&userId=0');
    expect(res.status).toBe(400);
  });

  it('passes a past and future range through', async () => {
    await get('?token=t&pastDays=90&futureDays=14');
    expect(buildAggregateFeed).toHaveBeenCalledWith(
      expect.objectContaining({ pastDays: 90, futureDays: 14 })
    );
  });

  it('omits the range entirely when not given, so the service default applies', async () => {
    await get('?token=t');
    const args = buildAggregateFeed.mock.calls[0][0];
    expect(args).not.toHaveProperty('pastDays');
    expect(args).not.toHaveProperty('futureDays');
  });

  it('refuses a range beyond a year rather than scanning it', async () => {
    expect((await get('?token=t&pastDays=400')).status).toBe(400);
    expect((await get('?token=t&futureDays=0')).status).toBe(400);
  });
});

describe('caching', () => {
  it('serves the calendar with an ETag', async () => {
    const res = await get('?token=t');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers.etag).toBe('"abc"');
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const res = await request(mount())
      .get('/api/calendar/aggregate.ics?token=t')
      .set('If-None-Match', '"abc"');

    expect(res.status).toBe(304);
  });
});
