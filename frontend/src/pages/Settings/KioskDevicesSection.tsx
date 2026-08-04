/**
 * Kiosk device configuration — Settings tab for admins (#309).
 *
 * A kiosk device is a shared tablet that punches employees in/out by employee
 * id, authenticated by a per-device token rather than a user session (see
 * `backend/src/services/KioskService.ts`). The raw token is returned exactly
 * once, at creation — it cannot be recovered afterward, only revoked and
 * reissued as a new device — so this screen shows it in a one-time reveal
 * rather than in the device list.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import { useKioskDevicesQuery, useKioskDeviceMutations } from '../../hooks/useKioskDevices';
import ConfirmModal from '../../components/ConfirmModal';
import QueryState from '../../components/QueryState';
import type { KioskDevice } from '../../types';

const KioskDevicesSection: React.FC = () => {
  const departmentsQuery = useDepartmentsQuery();
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const devicesQuery = useKioskDevicesQuery(departmentId);
  const { create, remove } = useKioskDeviceMutations(departmentId);

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [issuedToken, setIssuedToken] = useState<{ name: string; token: string } | null>(null);

  const departments = departmentsQuery.data ?? [];
  const devices = devicesQuery.data ?? [];

  const handleCreate = async () => {
    setError(null);
    if (!newName.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      const created = await create.mutateAsync({ name: newName.trim() });
      if (created) {
        setIssuedToken({ name: created.name, token: created.token });
      }
      setNewName('');
    } catch (err) {
      setError((err as Error).message || 'Failed to create kiosk device.');
    }
  };

  const handleRevoke = async () => {
    if (confirmRevokeId === null) return;
    try {
      await remove.mutateAsync(confirmRevokeId);
    } catch (err) {
      setError((err as Error).message || 'Failed to revoke kiosk device.');
    } finally {
      setConfirmRevokeId(null);
    }
  };

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">Kiosk Devices</h5>
          </div>
          <div className="card-body">
            <p className="text-muted small">
              A kiosk device is a shared tablet employees use to clock in or out by entering their
              employee id — no personal login required. Each device authenticates with its own token,
              shown once when the device is created.
            </p>

            <div className="mb-3">
              <label htmlFor="kiosk-department" className="form-label">Department</label>
              <select
                id="kiosk-department"
                className="form-select"
                value={departmentId ?? ''}
                onChange={(e) => {
                  setDepartmentId(e.target.value ? Number(e.target.value) : null);
                  setError(null);
                  setIssuedToken(null);
                }}
              >
                <option value="">Select a department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
              </div>
            )}

            {issuedToken && (
              <div className="alert alert-success" role="alert">
                <strong>{issuedToken.name}</strong> created. Copy this token into the device now — it will
                not be shown again.
                <div className="input-group mt-2">
                  <input className="form-control font-monospace" readOnly value={issuedToken.token} />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => navigator.clipboard.writeText(issuedToken.token)}
                  >
                    Copy
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-link"
                  onClick={() => setIssuedToken(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            {departmentId !== null && (
              <>
                <div className="input-group mb-3">
                  <input
                    className="form-control"
                    placeholder="Device name (e.g. Break room tablet)"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={handleCreate} disabled={create.isPending}>
                    <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>Add Device
                  </button>
                </div>

                <QueryState
                  isLoading={devicesQuery.isLoading}
                  isError={devicesQuery.isError}
                  error={devicesQuery.error}
                  onRetry={() => devicesQuery.refetch()}
                  isEmpty={devices.length === 0}
                  empty={<div className="text-muted text-center py-3">No kiosk devices for this department.</div>}
                >
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Status</th>
                        <th scope="col">Last used</th>
                        <th scope="col" className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map((device: KioskDevice) => (
                        <tr key={device.id}>
                          <td>{device.name}</td>
                          <td>
                            <span className={`badge ${device.isActive ? 'bg-success' : 'bg-secondary'}`}>
                              {device.isActive ? 'Active' : 'Revoked'}
                            </span>
                          </td>
                          <td>{device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString() : 'Never'}</td>
                          <td className="text-end">
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => setConfirmRevokeId(device.id)}
                              disabled={!device.isActive}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </QueryState>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        show={confirmRevokeId !== null}
        title="Revoke kiosk device"
        message="Are you sure you want to revoke this kiosk device? It will no longer be able to record punches."
        onConfirm={handleRevoke}
        onCancel={() => setConfirmRevokeId(null)}
      />
    </div>
  );
};

export default KioskDevicesSection;
