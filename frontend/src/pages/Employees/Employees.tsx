/**
 * Employees Page Component for Staff Scheduler
 *
 * Comprehensive employee management interface providing CRUD operations,
 * search functionality, and detailed employee information display.
 *
 * The row list (with per-row actions and the empty state) lives in
 * EmployeeTable; the create/edit form lives in EmployeeModal. This file owns
 * the filters, the query wiring, and the delete-confirm flow.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Employee } from '../../types';
import * as employeeService from '../../services/employeeService';
import ConfirmModal from '../../components/ConfirmModal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import ExportCsvLink from '../../components/ExportCsvLink';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import EmployeeTable from './EmployeeTable';
import EmployeeModal from './EmployeeModal';
import {
  useEmployeesQuery,
  useDepartmentsQuery,
  useDeleteEmployee,
  useSaveEmployee,
} from '../../hooks/useEmployees';

/**
 * Employees page component providing complete employee management.
 *
 * Server state (the employee list, the department dropdown, and the
 * create/update/delete mutations) is owned by TanStack Query hooks
 * (`useEmployees`), so this component no longer hand-manages loading flags,
 * a debounce timer, or manual list reloads — a mutation invalidates the
 * employees cache and the list refreshes itself. Only genuinely local UI state
 * (search text, open modals, the delete-confirm dialog, one-off action errors)
 * lives here.
 *
 * @returns JSX element containing the employee management interface
 */
const Employees: React.FC = () => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; employeeId: number | string | null }>({ open: false, employeeId: null });
  // One-off error from a mutation (save/delete), separate from the query's own
  // load error which comes straight from the hook.
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce the server-side filters so typing doesn't fetch on every keystroke;
  // the debounced values feed the query key, and TanStack Query does the rest.
  const debouncedSearch = useDebouncedValue(searchTerm, 300);
  const debouncedDepartment = useDebouncedValue(selectedDepartment, 300);

  const employeesQuery = useEmployeesQuery(debouncedSearch, debouncedDepartment);
  const departmentsQuery = useDepartmentsQuery();
  const deleteEmployee = useDeleteEmployee();
  const saveEmployee = useSaveEmployee();

  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const allDepartments = departmentsQuery.data ?? [];

  const handleDeleteEmployee = (id: number | string) => {
    setConfirmDelete({ open: true, employeeId: id });
  };

  const executeDelete = async () => {
    if (confirmDelete.employeeId === null) return;
    const id = confirmDelete.employeeId;
    setConfirmDelete({ open: false, employeeId: null });
    try {
      await deleteEmployee.mutateAsync(id);
    } catch (_err) {
      setActionError(t('employees.deleteFailed'));
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingEmployee(null);
  };

  const handleSaveEmployee = async (data: Parameters<typeof employeeService.createEmployee>[0]) => {
    if (editingEmployee && !editingEmployee.id) {
      // Guard: leave modal open so the user can see the error message.
      setActionError(t('employees.missingIdError'));
      return;
    }
    try {
      await saveEmployee.mutateAsync({
        id: editingEmployee ? editingEmployee.id!.toString() : undefined,
        data,
      });
      closeModal();
    } catch (_err) {
      setActionError(t('employees.saveFailed'));
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

  return (
    <div className="container-fluid py-4">
      {/* Header */}
      <div className="row mb-4">
        <div className="col">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1 className="h3 mb-0">{t('employees.title')}</h1>
              <p className="text-muted mb-0">
                {t('employees.subtitle')}
              </p>
            </div>
            <div className="d-flex gap-2">
            {/* The server applies the same search/department filters, so the
                file matches the table the user is looking at. */}
            <ExportCsvLink
              path="/employees/export"
              params={{ search: searchTerm, department: selectedDepartment }}
              disabled={filteredEmployees.length === 0}
              className="btn btn-outline-secondary"
            />
            <button
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              <i className="bi bi-plus-lg me-2" aria-hidden="true"></i>
              {t('employees.addEmployee')}
            </button>
            </div>
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
              placeholder={t('employees.searchPlaceholder')}
              aria-label={t('employees.searchAriaLabel')}
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
            <option value="">{t('employees.allDepartments')}</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <div className="text-end">
            <small className="text-muted">
              {t('employees.countSummary', { filtered: filteredEmployees.length, total: employees.length })}
            </small>
          </div>
        </div>
      </div>

      {actionError && <ErrorAlert message={actionError} />}

      {/* Employees Table */}
      <div className="card border-0 shadow-sm">
        <div className="card-body p-0">
          <QueryState
            isLoading={employeesQuery.isLoading}
            isError={employeesQuery.isError}
            error={employeesQuery.error}
            onRetry={() => employeesQuery.refetch()}
            loadingMessage={t('employees.loading')}
          >
            <EmployeeTable
              employees={filteredEmployees}
              searchTerm={searchTerm}
              selectedDepartment={selectedDepartment}
              onEdit={setEditingEmployee}
              onDelete={handleDeleteEmployee}
              onAddFirst={() => setShowAddModal(true)}
            />
          </QueryState>
        </div>
      </div>

      <ConfirmModal
        show={confirmDelete.open}
        title={t('employees.deleteModal.title')}
        message={t('employees.deleteModal.message')}
        confirmLabel={t('common.delete')}
        onConfirm={executeDelete}
        onCancel={() => setConfirmDelete({ open: false, employeeId: null })}
      />

      <EmployeeModal
        show={showAddModal || !!editingEmployee}
        editingEmployee={editingEmployee}
        departments={allDepartments}
        onClose={closeModal}
        onSubmit={handleSaveEmployee}
      />
    </div>
  );
};

export default Employees;
