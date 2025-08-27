import React from 'react';

const Reports: React.FC = () => {
  return (
    <div>
      <h1 className="h3 mb-4">Reports</h1>
      <div className="card">
        <div className="card-body text-center py-5">
          <i className="bi bi-graph-up text-muted" style={{ fontSize: '3rem' }}></i>
          <h5 className="mt-3">Reports & Analytics</h5>
          <p className="text-muted">Generate comprehensive workforce reports</p>
        </div>
      </div>
    </div>
  );
};

export default Reports;
