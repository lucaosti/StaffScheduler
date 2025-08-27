import React from 'react';

const Shifts: React.FC = () => {
  return (
    <div>
      <h1 className="h3 mb-4">Shifts Management</h1>
      <div className="card">
        <div className="card-body text-center py-5">
          <i className="bi bi-clock text-muted" style={{ fontSize: '3rem' }}></i>
          <h5 className="mt-3">Shift Management</h5>
          <p className="text-muted">Manage shift templates and schedules</p>
        </div>
      </div>
    </div>
  );
};

export default Shifts;
