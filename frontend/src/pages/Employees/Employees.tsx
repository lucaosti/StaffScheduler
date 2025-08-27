import React from 'react';

const Employees: React.FC = () => {
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">Employees</h1>
        <button className="btn btn-primary">
          <i className="bi bi-plus-lg me-2"></i>
          Add Employee
        </button>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="text-center py-5">
            <i className="bi bi-people text-muted" style={{ fontSize: '3rem' }}></i>
            <h5 className="mt-3">Employee Management</h5>
            <p className="text-muted">This page will contain employee management functionality</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Employees;
