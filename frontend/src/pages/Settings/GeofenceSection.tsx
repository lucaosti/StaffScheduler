/**
 * Geofence configuration — Settings tab for admins (#308).
 *
 * A fence's polygon is entered as a plain list of {lat, lng} rows rather than
 * drawn on a map: this project has consistently preferred a small amount of
 * owned code over a new dependency (see the CSV export, the rate limiter, and
 * #549's reasoning for XLSX), and a mapping library is exactly that kind of
 * dependency decision. Coordinates can be typed or pasted from any map
 * application's "copy coordinates" feature. A draw-on-a-map editor is a
 * reasonable future enhancement, not a blocker for the feature working.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import { useGeofencesQuery, useGeofenceMutations } from '../../hooks/useGeofences';
import ConfirmModal from '../../components/ConfirmModal';
import QueryState from '../../components/QueryState';
import type { Geofence, GeoPoint } from '../../types';

interface DraftPoint {
  lat: string;
  lng: string;
}

interface Draft {
  name: string;
  points: DraftPoint[];
  isActive: boolean;
}

const emptyDraft = (): Draft => ({
  name: '',
  points: [{ lat: '', lng: '' }, { lat: '', lng: '' }, { lat: '', lng: '' }],
  isActive: true,
});

const toDraft = (fence: Geofence): Draft => ({
  name: fence.name,
  points: fence.polygon.map((p) => ({ lat: String(p.lat), lng: String(p.lng) })),
  isActive: fence.isActive,
});

/** `null` for a row that isn't a valid coordinate yet — the caller filters these before submit. */
const parsePoint = (p: DraftPoint): GeoPoint | null => {
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (p.lat.trim() === '' || p.lng.trim() === '' || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
};

const GeofenceSection: React.FC = () => {
  const departmentsQuery = useDepartmentsQuery();
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const geofencesQuery = useGeofencesQuery(departmentId);
  const { create, update, remove } = useGeofenceMutations(departmentId);

  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const departments = departmentsQuery.data ?? [];
  const geofences = geofencesQuery.data ?? [];

  const startCreate = () => {
    setError(null);
    setEditing({ id: null, draft: emptyDraft() });
  };

  const startEdit = (fence: Geofence) => {
    setError(null);
    setEditing({ id: fence.id, draft: toDraft(fence) });
  };

  const updatePoint = (index: number, field: 'lat' | 'lng', value: string) => {
    if (!editing) return;
    const points = editing.draft.points.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    setEditing({ ...editing, draft: { ...editing.draft, points } });
  };

  const addPoint = () => {
    if (!editing) return;
    setEditing({ ...editing, draft: { ...editing.draft, points: [...editing.draft.points, { lat: '', lng: '' }] } });
  };

  const removePoint = (index: number) => {
    if (!editing) return;
    setEditing({ ...editing, draft: { ...editing.draft, points: editing.draft.points.filter((_, i) => i !== index) } });
  };

  const handleSave = async () => {
    if (!editing) return;
    setError(null);

    const polygon = editing.draft.points.map(parsePoint).filter((p): p is GeoPoint => p !== null);
    if (!editing.draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (polygon.length < 3) {
      setError('A geofence needs at least 3 valid coordinate points.');
      return;
    }

    try {
      if (editing.id === null) {
        await create.mutateAsync({ name: editing.draft.name, polygon, isActive: editing.draft.isActive });
      } else {
        await update.mutateAsync({ id: editing.id, data: { name: editing.draft.name, polygon, isActive: editing.draft.isActive } });
      }
      setEditing(null);
    } catch (err) {
      setError((err as Error).message || 'Failed to save geofence.');
    }
  };

  const handleDelete = async () => {
    if (confirmDeleteId === null) return;
    try {
      await remove.mutateAsync(confirmDeleteId);
    } catch (err) {
      setError((err as Error).message || 'Failed to delete geofence.');
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Clock-In Geofences</h5>
            {departmentId !== null && (
              <button className="btn btn-sm btn-primary" onClick={startCreate}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>New Geofence
              </button>
            )}
          </div>
          <div className="card-body">
            <p className="text-muted small">
              When a department has at least one active geofence, employees clocking in from that department must be
              inside one of its fences. Departments with no fences are unrestricted.
            </p>

            <div className="mb-3">
              <label htmlFor="geofence-department" className="form-label">Department</label>
              <select
                id="geofence-department"
                className="form-select"
                value={departmentId ?? ''}
                onChange={(e) => {
                  setDepartmentId(e.target.value ? Number(e.target.value) : null);
                  setEditing(null);
                  setError(null);
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

            {departmentId !== null && (
              <QueryState
                isLoading={geofencesQuery.isLoading}
                isError={geofencesQuery.isError}
                error={geofencesQuery.error}
                onRetry={() => geofencesQuery.refetch()}
                isEmpty={geofences.length === 0}
                empty={<div className="text-muted text-center py-3">No geofences configured for this department.</div>}
              >
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Points</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {geofences.map((fence) => (
                      <tr key={fence.id}>
                        <td>{fence.name}</td>
                        <td>{fence.polygon.length}</td>
                        <td>
                          <span className={`badge ${fence.isActive ? 'bg-success' : 'bg-secondary'}`}>
                            {fence.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => startEdit(fence)}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setConfirmDeleteId(fence.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </QueryState>
            )}

            {editing && (
              <div className="border rounded p-3 mt-3">
                <h6>{editing.id === null ? 'New geofence' : 'Edit geofence'}</h6>
                <div className="mb-2">
                  <label htmlFor="geofence-name" className="form-label">Name</label>
                  <input
                    id="geofence-name"
                    className="form-control"
                    value={editing.draft.name}
                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })}
                  />
                </div>
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="geofence-active"
                    checked={editing.draft.isActive}
                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, isActive: e.target.checked } })}
                  />
                  <label className="form-check-label" htmlFor="geofence-active">Active</label>
                </div>

                <label className="form-label">Boundary points (latitude, longitude)</label>
                {editing.draft.points.map((point, index) => (
                  <div className="input-group mb-1" key={index}>
                    <input
                      className="form-control"
                      placeholder="Latitude"
                      value={point.lat}
                      onChange={(e) => updatePoint(index, 'lat', e.target.value)}
                    />
                    <input
                      className="form-control"
                      placeholder="Longitude"
                      value={point.lng}
                      onChange={(e) => updatePoint(index, 'lng', e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => removePoint(index)}
                      disabled={editing.draft.points.length <= 3}
                      aria-label={`Remove point ${index + 1}`}
                    >
                      <i className="bi bi-x" aria-hidden="true"></i>
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={addPoint}>
                  <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>Add point
                </button>

                <div>
                  <button
                    className="btn btn-primary me-2"
                    onClick={handleSave}
                    disabled={create.isPending || update.isPending}
                  >
                    Save
                  </button>
                  <button className="btn btn-outline-secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        show={confirmDeleteId !== null}
        title="Delete geofence"
        message="Are you sure you want to delete this geofence?"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};

export default GeofenceSection;
