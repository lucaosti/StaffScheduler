import React from 'react';

const Settings: React.FC = () => {
  return (
    <div>
      <h1 className="h3 mb-4">Settings</h1>
      <div className="card">
        <div className="card-body text-center py-5">
          <i className="bi bi-gear text-muted" style={{ fontSize: '3rem' }}></i>
          <h5 className="mt-3">System Settings</h5>
          <p className="text-muted">Configure application settings and preferences</p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
