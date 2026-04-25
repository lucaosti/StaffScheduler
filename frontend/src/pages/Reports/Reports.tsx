/**
 * Reports Page Component
 *
 * Placeholder page for the future reporting module. The intended scope —
 * hours worked, cost per department, fairness, exports — is tracked in
 * ROADMAP.md (item F08). The page is intentionally inert: no fetches,
 * no fake metrics. The banner below tells users it is not yet available.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

// TODO(reports): implement report generation per ROADMAP.md F08
const Reports: React.FC = () => {
  return (
    <div>
      <h1 className="h3 mb-4">Reports</h1>

      <div className="alert alert-info d-flex align-items-center" role="status">
        <i className="bi bi-info-circle me-2" aria-hidden="true"></i>
        <div>
          <strong>Reports module coming soon.</strong> Hours worked, cost analysis, fairness
          metrics, and exports will be available in a future release.
        </div>
      </div>

      <div className="card">
        <div className="card-body text-center py-5">
          <i className="bi bi-graph-up text-muted" style={{ fontSize: '3rem' }} aria-hidden="true"></i>
          <h5 className="mt-3">Reports &amp; Analytics</h5>
          <p className="text-muted mb-0">Generate comprehensive workforce reports.</p>
        </div>
      </div>
    </div>
  );
};

export default Reports;
