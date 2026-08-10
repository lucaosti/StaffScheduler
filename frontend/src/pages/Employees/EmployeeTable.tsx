/**
 * EmployeeTable — the filtered employee list, with per-row edit/delete
 * actions and the "no results" empty state. See Employees.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Employee } from '../../types';

interface Props {
  employees: Employee[];
  searchTerm: string;
  selectedDepartment: string;
  onEdit: (employee: Employee) => void;
  onDelete: (id: number | string) => void;
  onAddFirst: () => void;
}

const EmployeeTable: React.FC<Props> = ({
  employees,
  searchTerm,
  selectedDepartment,
  onEdit,
  onDelete,
  onAddFirst,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead>
            <tr>
              <th scope="col">{t('employees.columns.employee')}</th>
              <th scope="col">{t('employees.columns.department')}</th>
              <th scope="col">{t('employees.columns.position')}</th>
              <th scope="col">{t('employees.columns.hourlyRate')}</th>
              <th scope="col">{t('employees.columns.status')}</th>
              <th scope="col" style={{ width: '120px' }}>{t('employees.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
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
                      <small className="text-muted">{t('employees.idPrefix')} {employee.employeeId}</small>
                    </div>
                  </div>
                </td>
                <td>{employee.department || t('common.emptyValue')}</td>
                <td>{employee.position || t('common.emptyValue')}</td>
                <td>
                  {employee.hourlyRate ? `€${employee.hourlyRate.toFixed(2)}` : t('common.emptyValue')}
                </td>
                <td>
                  <span className={`badge ${
                    employee.isActive ? 'bg-success' : 'bg-secondary'
                  }`}>
                    {employee.isActive ? t('employees.status.active') : t('employees.status.inactive')}
                  </span>
                </td>
                <td>
                  <div className="btn-group btn-group-sm">
                    <button
                      className="btn btn-outline-primary"
                      onClick={() => onEdit(employee)}
                      title={t('employees.editEmployeeTitle')}
                      aria-label={t('employees.editEmployeeAriaLabel')}
                    >
                      <i className="bi bi-pencil" aria-hidden="true"></i>
                    </button>
                    <button
                      className="btn btn-outline-danger"
                      onClick={() => employee.id !== undefined && onDelete(employee.id)}
                      title={t('employees.deleteEmployeeTitle')}
                      aria-label={t('employees.deleteEmployeeAriaLabel')}
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

      {employees.length === 0 && (
        <div className="text-center py-5">
          <i className="bi bi-people text-muted" style={{ fontSize: '3rem' }} aria-hidden="true"></i>
          <h5 className="mt-3">{t('employees.noneFound')}</h5>
          <p className="text-muted">
            {searchTerm || selectedDepartment
              ? t('employees.tryAdjustingFilters')
              : t('employees.getStarted')
            }
          </p>
          {!searchTerm && !selectedDepartment && (
            <button className="btn btn-primary" onClick={onAddFirst}>
              <i className="bi bi-plus-lg me-2"></i>
              {t('employees.addFirstEmployee')}
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default EmployeeTable;
