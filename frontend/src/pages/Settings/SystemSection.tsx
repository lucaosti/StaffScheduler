/**
 * SystemSection — System-wide configuration tab (admin only).
 *
 * Persists currency and time-period settings via the settings API.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import {
  isCurrency,
  isTimePeriod,
  type Currency,
  type TimePeriod,
} from '../../services/settingsService';
import { useSystemSettingsQuery, useSaveSystemSettings } from '../../hooks/useSystemSettings';

/**
 * Option lists typed against the contract enums.
 *
 * Declaring them this way rather than as literal `<option value="…">` markup
 * means an option whose value the endpoint does not accept is a compile error.
 * The two lists previously matched the schema by coincidence; a fifth time
 * period added to the UI would have looked like a working setting and been
 * rejected on save. Labels stay here because they are presentation.
 */
const CURRENCY_OPTIONS: ReadonlyArray<{ value: Currency; label: string }> = [
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — US Dollar' },
];

const TIME_PERIOD_OPTIONS: ReadonlyArray<{ value: TimePeriod; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const SystemSection: React.FC = () => {
  // Narrowed to the values the endpoints accept, rather than `string`. The
  // select offers exactly these, so nothing the user can pick changes; what it
  // stops is the load path below feeding an unexpected stored value straight
  // back to a PUT that rejects it.
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('monthly');
  const [success, setSuccess] = useState<string | null>(null);
  const [actionError, setError] = useState<string | null>(null);

  const settingsQuery = useSystemSettingsQuery();
  const loading = settingsQuery.isLoading;
  const error = settingsQuery.isError
    ? null // Non-critical: the form defaults are still usable, matching the prior fetch-error tolerance.
    : actionError;
  const save = useSaveSystemSettings();
  const saving = save.isPending;

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    const currencySetting = data.find((s) => s.category === 'general' && s.key === 'currency');
    const periodSetting = data.find((s) => s.category === 'schedule' && s.key === 'default_time_period');
    // `system_settings` is a free-text key/value table, so a stored value is
    // not guaranteed to be one the endpoint still accepts (an older release,
    // a manual edit, a seed). Feeding it back unchecked left the select with
    // no matching option — silently showing the wrong setting — and then
    // submitted it, earning a 400 the user could not act on. An unrecognised
    // value keeps the default instead.
    if (currencySetting && isCurrency(currencySetting.value)) {
      setCurrency(currencySetting.value);
    }
    if (periodSetting && isTimePeriod(periodSetting.value)) {
      setTimePeriod(periodSetting.value);
    }
  }, [settingsQuery.data]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    setError(null);
    try {
      await save.mutateAsync({ currency, timePeriod });
      setSuccess('System settings saved successfully.');
    } catch (err) {
      setError((err as Error).message || 'Failed to save system settings.');
    }
  };

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">System Configuration</h5>
          </div>
          <div className="card-body">
            {success && (
              <div className="alert alert-success" role="status">
                <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
                {success}
              </div>
            )}
            {error && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
                {error}
              </div>
            )}
            <div className="alert alert-info">
              <i className="bi bi-info-circle me-2" aria-hidden="true"></i>
              System-wide settings that affect all users.
            </div>

            {loading ? (
              <div className="text-center py-3">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                <span className="ms-2">Loading settings…</span>
              </div>
            ) : (
              <form onSubmit={handleSave}>
                <h6 className="mb-3">Financial Settings</h6>
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label htmlFor="currency" className="form-label">Currency</label>
                    <select
                      className="form-select"
                      id="currency"
                      value={currency}
                      onChange={(e) => {
                        if (isCurrency(e.target.value)) setCurrency(e.target.value);
                      }}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label htmlFor="timePeriod" className="form-label">Default Time Period</label>
                    <select
                      className="form-select"
                      id="timePeriod"
                      value={timePeriod}
                      onChange={(e) => {
                        if (isTimePeriod(e.target.value)) setTimePeriod(e.target.value);
                      }}
                    >
                      {TIME_PERIOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        ></span>
                        Saving…
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check me-2"></i>
                        Save System Settings
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemSection;
