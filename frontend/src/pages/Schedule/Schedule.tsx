import React from 'react';

const Schedule: React.FC = () => {
  return (
    <div>
      <h1 className="h3 mb-4">Schedule</h1>
      <div className="card">
        <div className="card-body text-center py-5">
          <i className="bi bi-calendar3 text-muted" style={{ fontSize: '3rem' }}></i>
          <h5 className="mt-3">Schedule Management</h5>
          <p className="text-muted">View and manage work schedules</p>
        </div>
      </div>
    </div>
  );
};

export default Schedule;
