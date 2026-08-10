/**
 * useSettingsSectionSave — the save/success/error boilerplate every
 * Settings/* section repeated: a `saving` flag, a success banner message,
 * an error banner message, and a `try { await mutate() } catch { setError }
 * finally { setSaving(false) }` wrapper around it.
 *
 * One instance covers a section with several independent actions (e.g. a
 * create and a delete) — `run` takes the success message and error fallback
 * per call, so the same `success`/`error`/`saving` triple serves all of
 * them rather than each action needing its own copy of this state.
 *
 * Deliberately NOT built on top of a TanStack Query mutation's own
 * `isPending`/`error`: several sections drive more than one mutation (or a
 * validation failure that never reaches one) from the same pair of banners,
 * and `run` covers that by wrapping whatever async action it's given rather
 * than being tied to one mutation object.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';

export function useSettingsSectionSave() {
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const run = async (
    action: () => Promise<unknown>,
    successMessage: string,
    errorFallback: string
  ): Promise<boolean> => {
    setSuccess(null);
    setError(null);
    setSaving(true);
    try {
      await action();
      setSuccess(successMessage);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : errorFallback);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { success, error, saving, run, setSuccess, setError };
}
