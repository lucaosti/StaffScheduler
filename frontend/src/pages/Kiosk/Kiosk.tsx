/**
 * Kiosk clock-in page (#309) — public route, no user session.
 *
 * A shared tablet parked at `/kiosk`: an employee types their employee id and
 * the device toggles their clock-in/clock-out state. The device itself
 * authenticates with a token entered once and kept in localStorage, scoped to
 * this browser/tablet rather than to any person — there is deliberately no
 * login form here, since the whole point is that no employee needs an
 * account on the shared device to punch in.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { punchKiosk, KioskPunchResult } from '../../services/attendanceService';
import { ApiError } from '../../services/apiUtils';

const TOKEN_STORAGE_KEY = 'kioskDeviceToken';

const Kiosk: React.FC = () => {
  const { t } = useTranslation();
  const [deviceToken, setDeviceToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [tokenDraft, setTokenDraft] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KioskPunchResult | null>(null);

  const configureDevice = () => {
    if (!tokenDraft.trim()) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenDraft.trim());
    setDeviceToken(tokenDraft.trim());
    setTokenDraft('');
  };

  const forgetDevice = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setDeviceToken(null);
    setResult(null);
    setError(null);
  };

  const handlePunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceToken || !employeeId.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const response = await punchKiosk(deviceToken, employeeId.trim());
      if (response.data) setResult(response.data);
      setEmployeeId('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(t('kiosk.deviceNotRegistered'));
      } else {
        setError((err as Error).message || t('kiosk.punchFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!deviceToken) {
    return (
      <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
        <div className="card shadow-sm" style={{ width: '24rem' }}>
          <div className="card-body">
            <h5 className="card-title mb-3">{t('kiosk.configureTitle')}</h5>
            <p className="text-muted small">
              {t('kiosk.configureHelp')}
            </p>
            <input
              className="form-control mb-3 font-monospace"
              placeholder={t('kiosk.deviceTokenPlaceholder')}
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && configureDevice()}
            />
            <button className="btn btn-primary w-100" onClick={configureDevice} disabled={!tokenDraft.trim()}>
              {t('kiosk.saveDevice')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="card shadow-sm" style={{ width: '24rem' }}>
        <div className="card-body">
          <h5 className="card-title mb-3">{t('kiosk.clockTitle')}</h5>

          {result && (
            <div className="alert alert-success" role="alert">
              {t(result.action === 'clocked_in' ? 'kiosk.clockedInMessage' : 'kiosk.clockedOutMessage', { name: result.employeeName })}
            </div>
          )}

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handlePunch}>
            <input
              className="form-control mb-3"
              placeholder={t('kiosk.employeeIdPlaceholder')}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              autoFocus
              disabled={submitting}
            />
            <button type="submit" className="btn btn-primary w-100" disabled={submitting || !employeeId.trim()}>
              {submitting ? t('kiosk.submitting') : t('kiosk.punch')}
            </button>
          </form>

          <button type="button" className="btn btn-sm btn-link mt-3" onClick={forgetDevice}>
            {t('kiosk.reconfigure')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Kiosk;
