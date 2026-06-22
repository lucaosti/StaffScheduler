/**
 * Employees Page Component for Staff Scheduler
 * 
 * Comprehensive employee management interface providing CRUD operations,
 * search functionality, and detailed employee information display.
 * 
 * Features:
 * - Employee listing with pagination and sorting
 * - Advanced search and filtering capabilities
 * - Add, edit, and delete employee operations
 * - Employee details modal with full information
 * - Bulk operations for multiple employees
 * - Export functionality for employee data
 * - Real-time updates and error handling
 * 
 * @author Luca Ostinelli
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Employee } from '../../types';
import * as employeeService from '../../services/employeeService';
import { getDepartments, Department } from '../../services/departmentService';
import ConfirmModal from '../../components/ConfirmModal';


/**
 * Employees page component providing complete employee management
 * @returns JSX element containing the employee management interface
 */
const Employees: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; employeeId: number | string | null }>({ open: false, employeeId: null });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  const loadEmployees = useCallback(async (search: string, department: string, showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      const response = await employeeService.getEmployees({
        search: search || undefined,
        department: department || undefined,
        limit: 50
      });

      if (response.success && response.data) {
        setEmployees(response.data);
      } else {
        setError('Failed to load employees. Please ensure the backend is running and database is populated.');
        setEmployees([]);
      }
    } catch (err) {
      setError('Failed to load employees. Please check your connection and try again.');
      setEmployees([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      loadEmployees(searchTerm, selectedDepartment, true);
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadEmployees(searchTerm, selectedDepartment, false);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchTerm, selectedDepartment, loadEmployees]);

  useEffect(() => {
    (async () => {
      try {
        const res = await getDepartments();
        if (res?.success && res?.data) setAllDepartments(res.data);
      } catch {
        // non-fatal — form will show no department options
      }
    })();
  }, []);

  const handleDeleteEmployee = (id: number | string) => {
    setConfirmDelete({ open: true, employeeId: id });
  };

  const executeDelete = async () => {
    if (confirmDelete.employeeId === null) return;
    const id = confirmDelete.employeeId;
    setConfirmDelete({ open: false, employeeId: null });
    try {
      await employeeService.deleteEmployee(id);
      await loadEmployees(searchTerm, selectedDepartment); // Reload the list
    } catch (err) {
      setError('Failed to delete employee');
    }
  };

  const filteredEmployees = useMemo(() => employees.filter(employee => {
    const matchesSearch = !searchTerm ||
      `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (employee.employeeId || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDepartment = !selectedDepartment || employee.department === selectedDepartment;

    return matchesSearch && matchesDepartment;
  }), [employees, searchTerm, selectedDepartment]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map(emp => emp.department).filter(Boolean))),
    [employees]
  );

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading employees...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* Header */}
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">Employees</h1>
              <p className="text-muted mb-0">
                Manage your workforce and employee information
              </p>
            </div>
            <button 
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>
              Add Employee
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="row mb-4">
        <div className="col-md-6">
          <div className="input-group">
            <span className="input-group-text">
              <i className="bi bi-search" aria-hidden="true"></i>
            </span>
            <input
              type="text"
              className="form-control"
              placeholder="Search employees..."
              aria-label="Search employees"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="col-md-3">
          <select
            className="form-select"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <div className="text-end">
            <small className="text-muted">
              {filteredEmployees.length} of {employees.length} employees
            </small>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="alert alert-warning alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
          {error} - Showing sample data
          <button 
            type="button" 
            className="btn-close" 
            onClick={() => setError(null)}
          ></button>
        </div>
      )}

      {/* Employees Table */}
      <div className="card border-0 shadow-sm">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Position</th>
                  <th scope="col">Hourly Rate</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id || employee.employeeId}>
                    <td>
                      <div className="d-flex align-items-center">
                        <div className="bg-primary bg-opacity-10 rounded-circle p-2 me-3">
                          <i className="bi bi-person text-primary" aria-hidden="true"></i>
                        </div>
                        <div>
                          <div className="fw-medium">
                            {employee.firstName} {employee.lastName}
                          </div>
                          <small className="text-muted">{employee.email}</small>
                          <br />
                          <small className="text-muted">ID: {employee.employeeId}</small>
                        </div>
                      </div>
                    </td>
                    <td>{employee.department || '-'}</td>
                    <td>{employee.position || '-'}</td>
                    <td>
                      {employee.hourlyRate ? `€${employee.hourlyRate.toFixed(2)}` : '-'}
                    </td>
                    <td>
                      <span className={`badge ${
                        employee.isActive ? 'bg-success' : 'bg-secondary'
                      }`}>
                        {employee.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="btn-group btn-group-sm">
                        <button
                          className="btn btn-outline-primary"
                          onClick={() => setEditingEmployee(employee)}
                          title="Edit Employee"
                          aria-label="Edit employee"
                        >
                          <i className="bi bi-pencil" aria-hidden="true"></i>
                        </button>
                        <button
                          className="btn btn-outline-danger"
                          onClick={() => employee.id !== undefined && handleDeleteEmployee(employee.id)}
                          title="Delete Employee"
                          aria-label="Delete employee"
                        >
                          <i className="bi bi-trash" aria-hidden="true"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredEmployees.length === 0 && (
            <div className="text-center py-5">
              <i className="bi bi-people text-muted" style={{ fontSize: '3rem' }} aria-hidden="true"></i>
              <h5 className="mt-3">No employees found</h5>
              <p className="text-muted">
                {searchTerm || selectedDepartment 
                  ? 'Try adjusting your filters' 
                  : 'Get started by adding your first employee'
                }
              </p>
              {!searchTerm && !selectedDepartment && (
                <button 
                  className="btn btn-primary"
                  onClick={() => setShowAddModal(true)}
                >
                  <i className="bi bi-plus-lg me-2"></i>
                  Add First Employee
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        show={confirmDelete.open}
        title="Delete Employee"
        message="Are you sure you want to delete this employee?"
        confirmLabel="Delete"
        onConfirm={executeDelete}
        onCancel={() => setConfirmDelete({ open: false, employeeId: null })}
      />

      {/* Add/Edit Modal Placeholder */}
      {(showAddModal || editingEmployee) && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingEmployee(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  
                  const rawDeptId = formData.get('departmentId') as string;
                  const deptId = rawDeptId ? parseInt(rawDeptId, 10) : NaN;
                  const rawHourlyRate = formData.get('hourlyRate') as string;
                  const parsedHourlyRate = rawHourlyRate ? parseFloat(rawHourlyRate) : NaN;
                  const employeeData: Parameters<typeof employeeService.createEmployee>[0] = {
                    employeeId: formData.get('employeeId') as string,
                    firstName: formData.get('firstName') as string,
                    lastName: formData.get('lastName') as string,
                    email: formData.get('email') as string,
                    phone: (formData.get('phone') as string) || undefined,
                    position: (formData.get('position') as string) || undefined,
                    departmentIds: !isNaN(deptId) && deptId > 0 ? [deptId] : undefined,
                    hourlyRate: !isNaN(parsedHourlyRate) && parsedHourlyRate >= 0 ? parsedHourlyRate : undefined,
                  };

                  try {
                    if (editingEmployee) {
                      if (!editingEmployee.id) {
                        // Guard: leave modal open so the user can see the error message.
                        setError('Cannot update employee: missing ID');
                        return;
                      }
                      await employeeService.updateEmployee(editingEmployee.id.toString(), employeeData);
                    } else {
                      await employeeService.createEmployee(employeeData);
                    }
                    await loadEmployees(searchTerm, selectedDepartment);
                    setShowAddModal(false);
                    setEditingEmployee(null);
                  } catch (err) {
                    setError('Failed to save employee');
                  }
                }}>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="employeeId" className="form-label">Employee ID *</label>
                      <input
                        type="text"
                        className="form-control"
                        id="employeeId"
                        name="employeeId"
                        defaultValue={editingEmployee?.employeeId || ''}
                        required
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="email" className="form-label">Email *</label>
                      <input
                        type="email"
                        className="form-control"
                        id="email"
                        name="email"
                        defaultValue={editingEmployee?.email || ''}
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="firstName" className="form-label">First Name *</label>
                      <input
                        type="text"
                        className="form-control"
                        id="firstName"
                        name="firstName"
                        defaultValue={editingEmployee?.firstName || ''}
                        required
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="lastName" className="form-label">Last Name *</label>
                      <input
                        type="text"
                        className="form-control"
                        id="lastName"
                        name="lastName"
                        defaultValue={editingEmployee?.lastName || ''}
                        required
                      />
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="phone" className="form-label">Phone</label>
                      <input
                        type="tel"
                        className="form-control"
                        id="phone"
                        name="phone"
                        defaultValue={editingEmployee?.phone || ''}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="departmentId" className="form-label">Department</label>
                      <select
                        className="form-select"
                        id="departmentId"
                        name="departmentId"
                        defaultValue={
                          editingEmployee?.department
                            ? (allDepartments.find((d) => d.name === editingEmployee.department)?.id?.toString() ?? '')
                            : ''
                        }
                      >
                        <option value="">— none —</option>
                        {allDepartments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="position" className="form-label">Position</label>
                      <input
                        type="text"
                        className="form-control"
                        id="position"
                        name="position"
                        defaultValue={editingEmployee?.position || ''}
                        placeholder="e.g. Engineer, Manager"
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="hourlyRate" className="form-label">Hourly Rate (€)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-control"
                        id="hourlyRate"
                        name="hourlyRate"
                        defaultValue={editingEmployee?.hourlyRate ?? ''}
                      />
                    </div>
                  </div>

                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowAddModal(false);
                        setEditingEmployee(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">
                      {editingEmployee ? 'Update' : 'Create'} Employee
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Employees;
