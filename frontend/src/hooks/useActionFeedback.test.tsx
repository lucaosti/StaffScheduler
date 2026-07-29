/**
 * The shared action-feedback hook.
 *
 * The behaviour worth pinning is that the SERVER'S message survives. Eight
 * pages relied on it before it was shared, and every one of them existed to
 * relay a refusal that names something specific — an overlapping period, a
 * conflicting assignment, a skill three people hold. A version that replaced
 * those with "failed" would pass a test asserting only that an alert appeared.
 *
 * @author Luca Ostinelli
 */

import { act, renderHook } from '@testing-library/react';
import { useActionFeedback } from './useActionFeedback';

describe('useActionFeedback', () => {
  it('starts with nothing to say', () => {
    const { result } = renderHook(() => useActionFeedback());
    expect(result.current.message).toBeNull();
  });

  it('reports success and leaves the message clear', async () => {
    const { result } = renderHook(() => useActionFeedback());
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.run(Promise.resolve('ok'));
    });
    expect(outcome).toBe(true);
    expect(result.current.message).toBeNull();
  });

  it('keeps the server\'s own words', async () => {
    const { result } = renderHook(() => useActionFeedback());
    await act(async () => {
      await result.current.run(
        Promise.reject(new Error('Cannot delete a skill in use (3 employee(s))'))
      );
    });
    // Not "failed": the counts are the whole value of the refusal.
    expect(result.current.message).toBe('Cannot delete a skill in use (3 employee(s))');
  });

  it('reports failure so the caller can skip its follow-up', async () => {
    const { result } = renderHook(() => useActionFeedback());
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.run(Promise.reject(new Error('no')));
    });
    // Pages close a picker or clear a form only when the action actually
    // succeeded.
    expect(outcome).toBe(false);
  });

  it('falls back to a plain sentence for a non-Error rejection', async () => {
    const { result } = renderHook(() => useActionFeedback());
    await act(async () => {
      await result.current.run(Promise.reject('a bare string'));
    });
    // A thrown string has no `.message`; printing "undefined" would be worse
    // than saying nothing useful.
    expect(result.current.message).toBe('The request failed');
  });

  it('clears a previous message before running again', async () => {
    const { result } = renderHook(() => useActionFeedback());
    await act(async () => {
      await result.current.run(Promise.reject(new Error('first')));
    });
    expect(result.current.message).toBe('first');

    await act(async () => {
      await result.current.run(Promise.resolve());
    });
    // A stale refusal next to a control that has since worked reads as a
    // failure that did not happen.
    expect(result.current.message).toBeNull();
  });
});
