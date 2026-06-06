/**
 * SystemSection — System-wide configuration tab (admin only).
 *
 * @author Luca Ostinelli
 */

import React from 'react';

const SystemSection: React.FC = () => (
  <div className="row">
    <div className="col-lg-8">
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">System Configuration</h5>
        </div>
        <div className="card-body">
          <div className="alert alert-info">
            <i className="bi bi-info-circle me-2"></i>
            System-wide settings that affect all users. Changes here require system restart.
          </div>

          <h6 className="mb-3">Database Settings</h6>
          <div className="row">
            <div className="col-md-6 mb-3">
              <label className="form-label">Backup Frequency</label>
              <select className="form-select">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label">Log Retention (days)</label>
              <input type="number" className="form-control" defaultValue={30} />
            </div>
          </div>

          <h6 className="mb-3">Security Settings</h6>
          <div className="row">
            <div className="col-md-6 mb-3">
              <label className="form-label">Session Timeout (hours)</label>
              <input type="number" className="form-control" defaultValue={8} />
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label">Password Complexity</label>
              <select className="form-select">
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="high">High Security</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <button type="button" className="btn btn-primary me-2">
              <i className="bi bi-check me-2"></i>
              Save System Settings
            </button>
            <button type="button" className="btn btn-outline-secondary">
              <i className="bi bi-arrow-clockwise me-2"></i>
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default SystemSection;
