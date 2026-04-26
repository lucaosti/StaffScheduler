/**
 * EventBus tests (F18).
 *
 * The bus is process-local pub/sub backed by a Map; tests use a stub
 * Response with a synchronous write() spy so we can assert the SSE
 * frames sent to subscribers.
 */

import type { Response } from 'express';
import { eventBus } from '../services/EventBus';

const fakeResponse = () => {
  const writes: string[] = [];
  const res = {
    write: jest.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
  } as unknown as Response;
  return { res, writes };
};

describe('EventBus', () => {
  afterEach(() => {
    // Reset internal state between tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (eventBus as any).subscribers = new Map();
  });

  it('formatFrame produces a SSE event with type and JSON data', () => {
    const frame = eventBus.formatFrame({ type: 'shift.created', payload: { id: 1 } });
    expect(frame).toBe('event: shift.created\ndata: {"id":1}\n\n');
  });

  it('publish writes a frame to every subscriber of the user', () => {
    const a = fakeResponse();
    const b = fakeResponse();
    eventBus.subscribe(7, a.res);
    eventBus.subscribe(7, b.res);
    eventBus.publish(7, { type: 't', payload: { x: 1 } });
    expect(a.res.write).toHaveBeenCalledWith('event: t\ndata: {"x":1}\n\n');
    expect(b.res.write).toHaveBeenCalledWith('event: t\ndata: {"x":1}\n\n');
  });

  it('publish does not touch other users', () => {
    const owner = fakeResponse();
    const other = fakeResponse();
    eventBus.subscribe(7, owner.res);
    eventBus.subscribe(8, other.res);
    eventBus.publish(7, { type: 't' });
    expect(owner.res.write).toHaveBeenCalled();
    expect(other.res.write).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the response and shrinks the bus', () => {
    const a = fakeResponse();
    const b = fakeResponse();
    eventBus.subscribe(7, a.res);
    eventBus.subscribe(7, b.res);
    expect(eventBus.size()).toBe(2);
    eventBus.unsubscribe(7, a.res);
    expect(eventBus.size()).toBe(1);
    eventBus.publish(7, { type: 't' });
    expect(a.res.write).not.toHaveBeenCalled();
    expect(b.res.write).toHaveBeenCalled();
  });

  it('publish to a user with no subscribers is a no-op', () => {
    expect(() => eventBus.publish(99, { type: 't' })).not.toThrow();
  });

  it('a write throw is swallowed (the close handler will clean up)', () => {
    const res = {
      write: jest.fn(() => {
        throw new Error('socket dead');
      }),
    } as unknown as Response;
    eventBus.subscribe(7, res);
    expect(() => eventBus.publish(7, { type: 't' })).not.toThrow();
  });
});
