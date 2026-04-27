/**
 * Calendar route integration tests (F04 / F04++).
 */

import express from 'express';
import request from 'supertest';
import { createCalendarRouter } from '../routes/calendar';

type Tuple = [unknown, unknown];

const makePool = () => {
  const execute = jest.fn();
  return { pool: { execute } as never, execute };
};

describe('GET /api/calendar/feed.ics', () => {
  it('returns 401 when no token query parameter is provided', async () => {
    const { pool } = makePool();
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/feed.ics');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is unknown', async () => {
    const { pool, execute } = makePool();
    execute.mockResolvedValueOnce([[], null] as Tuple); // resolveToken
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/feed.ics?token=nope');
    expect(res.status).toBe(401);
  });

  it('returns 200 with text/calendar + ETag when token resolves', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ user_id: 7 }], null] as Tuple) // resolveToken
      .mockResolvedValueOnce([[], null] as Tuple) // shifts (none)
      .mockResolvedValueOnce([[], null] as Tuple); // on-call (none)
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/feed.ics?token=abc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.headers.etag).toMatch(/^"[a-f0-9]+"$/);
    expect(res.text).toContain('BEGIN:VCALENDAR');
  });

  it('returns 304 when If-None-Match matches the current ETag', async () => {
    const { pool, execute } = makePool();
    // First request to get the ETag.
    execute
      .mockResolvedValueOnce([[{ user_id: 7 }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const first = await request(app).get('/api/calendar/feed.ics?token=abc');
    const etag = first.headers.etag;
    // Second request with If-None-Match.
    execute
      .mockResolvedValueOnce([[{ user_id: 7 }], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple)
      .mockResolvedValueOnce([[], null] as Tuple);
    const second = await request(app)
      .get('/api/calendar/feed.ics?token=abc')
      .set('If-None-Match', etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});

describe('GET /api/calendar/department/:id.ics', () => {
  it('returns 401 without a token', async () => {
    const { pool } = makePool();
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/department/3.ics');
    expect(res.status).toBe(401);
  });

  it('returns 403 when the resolved user is not admin or department manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ user_id: 7 }], null] as Tuple) // resolveToken
      .mockResolvedValueOnce([[{ role: 'employee', manager_id: null }], null] as Tuple);
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/department/3.ics?token=abc');
    expect(res.status).toBe(403);
  });

  it('returns 200 with the aggregated feed for the department manager', async () => {
    const { pool, execute } = makePool();
    execute
      .mockResolvedValueOnce([[{ user_id: 7 }], null] as Tuple) // resolveToken
      .mockResolvedValueOnce([[{ role: 'manager', manager_id: 7 }], null] as Tuple) // role check
      .mockResolvedValueOnce([[], null] as Tuple); // department feed query
    const app = express();
    app.use('/api/calendar', createCalendarRouter(pool));
    const res = await request(app).get('/api/calendar/department/3.ics?token=abc');
    expect(res.status).toBe(200);
    expect(res.text).toContain('BEGIN:VCALENDAR');
  });
});
