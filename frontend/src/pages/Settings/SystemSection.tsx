/**
 * SystemSection — System-wide configuration tab (admin only).
 *
 * Persists currency and time-period settings via the settings API.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { updateCurrency, updateTimePeriod, getSystemSettings } from '../../services/settingsService';

const SystemSection: React.FC = () => {
  const [currency, setCurrency] = useState<string>('EUR');
  const [timePeriod, setTimePeriod] = useState<string>('monthly');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getSystemSettings();
        if (result.success && result.data) {
          const currencySetting = result.data.find(
            (s) => s.category === 'general' && s.key === 'currency'
          );
          const periodSetting = result.data.find(
            (s) => s.category === 'schedule' && s.key === 'default_time_period'
          );
          if (currencySetting) setCurrency(currencySetting.value);
          if (periodSetting) setTimePeriod(periodSetting.value);
        }
      } catch {
        // Non-critical: the form defaults are still usable.
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      await Promise.all([updateCurrency(currency), updateTimePeriod(timePeriod)]);
      setSuccess('System settings saved successfully.');
    } catch (err) {
      setError((err as Error).message || 'Failed to save system settings.');
    } finally {
      setSaving(false);
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
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      <option value="EUR">EUR — Euro</option>
                      <option value="USD">USD — US Dollar</option>
                    </select>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label htmlFor="timePeriod" className="form-label">Default Time Period</label>
                    <select
                      className="form-select"
                      id="timePeriod"
                      value={timePeriod}
                      onChange={(e) => setTimePeriod(e.target.value)}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
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
