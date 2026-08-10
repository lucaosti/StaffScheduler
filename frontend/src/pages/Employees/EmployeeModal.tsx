/**
 * EmployeeModal — create/edit employee form.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Department, Employee } from '../../types';
import * as employeeService from '../../services/employeeService';

interface Props {
  show: boolean;
  editingEmployee: Employee | null;
  departments: Department[];
  onClose: () => void;
  onSubmit: (data: Parameters<typeof employeeService.createEmployee>[0]) => void;
}

const EmployeeModal: React.FC<Props> = ({ show, editingEmployee, departments, onClose, onSubmit }) => {
  const { t } = useTranslation();

  if (!show) return null;

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {editingEmployee ? t('employees.modal.editTitle') : t('employees.modal.addTitle')}
            </h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);

              const rawDeptId = formData.get('departmentId') as string;
              const deptId = rawDeptId ? parseInt(rawDeptId, 10) : NaN;
              const rawHourlyRate = formData.get('hourlyRate') as string;
              const parsedHourlyRate = rawHourlyRate ? parseFloat(rawHourlyRate) : NaN;

              onSubmit({
                employeeId: formData.get('employeeId') as string,
                firstName: formData.get('firstName') as string,
                lastName: formData.get('lastName') as string,
                email: formData.get('email') as string,
                // Required by createUserBody on create; absent on update.
                password: (formData.get('password') as string) ?? '',
                phone: (formData.get('phone') as string) || undefined,
                position: (formData.get('position') as string) || undefined,
                departmentIds: !isNaN(deptId) && deptId > 0 ? [deptId] : undefined,
                hourlyRate: !isNaN(parsedHourlyRate) && parsedHourlyRate >= 0 ? parsedHourlyRate : undefined,
              });
            }}>
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="employeeId" className="form-label">{t('employees.form.employeeId')}</label>
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
                  <label htmlFor="email" className="form-label">{t('employees.form.email')}</label>
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

              {/*
                POST /employees validates against the shared createUserBody
                schema, which requires a password of at least 8 characters.
                The form did not collect one, so every creation from the UI
                was rejected with a 400 — invisible because the frontend
                payload type did not declare the field either. Updates go
                through updateUserBody, which has no password, so this is
                shown and required only when creating.
              */}
              {!editingEmployee && (
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label htmlFor="password" className="form-label">{t('employees.form.initialPassword')}</label>
                    <input
                      type="password"
                      className="form-control"
                      id="password"
                      name="password"
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                    <div className="form-text">{t('employees.form.passwordHelp')}</div>
                  </div>
                </div>
              )}

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="firstName" className="form-label">{t('employees.form.firstName')}</label>
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
                  <label htmlFor="lastName" className="form-label">{t('employees.form.lastName')}</label>
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
                  <label htmlFor="phone" className="form-label">{t('employees.form.phone')}</label>
                  <input
                    type="tel"
                    className="form-control"
                    id="phone"
                    name="phone"
                    defaultValue={editingEmployee?.phone || ''}
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="departmentId" className="form-label">{t('employees.form.department')}</label>
                  <select
                    className="form-select"
                    id="departmentId"
                    name="departmentId"
                    defaultValue={
                      editingEmployee?.department
                        ? (departments.find((d) => d.name === editingEmployee.department)?.id?.toString() ?? '')
                        : ''
                    }
                  >
                    <option value="">{t('employees.form.noneOption')}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="position" className="form-label">{t('employees.form.position')}</label>
                  <input
                    type="text"
                    className="form-control"
                    id="position"
                    name="position"
                    defaultValue={editingEmployee?.position || ''}
                    placeholder={t('employees.form.positionPlaceholder')}
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="hourlyRate" className="form-label">{t('employees.form.hourlyRate')}</label>
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
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingEmployee ? t('employees.modal.update') : t('employees.modal.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeModal;
