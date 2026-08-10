/**
 * WeekView — the week grid of the Schedule page: a day-by-day agenda list on
 * narrow viewports, a shift × day table on wide ones. Both render the same
 * underlying shifts/assignments, just laid out differently — see Schedule.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Employee, Shift, ShiftAssignment } from '../../types';
import { toLocalDateString } from '../../utils/format';

interface Props {
  isNarrow: boolean;
  weekDates: Date[];
  filteredShifts: Shift[];
  departmentNameById: Map<number, string>;
  getAssignmentsForDateAndShift: (date: Date, shiftId: string | number) => ShiftAssignment[];
  getEmployeeById: (employeeId: string | number) => Employee | undefined;
  formatDate: (date: Date) => string;
}

const WeekView: React.FC<Props> = ({
  isNarrow,
  weekDates,
  filteredShifts,
  departmentNameById,
  getAssignmentsForDateAndShift,
  getEmployeeById,
  formatDate,
}) => {
  const { t } = useTranslation();

  const deptNameOf = (shift: Shift) =>
    shift.departmentName ||
    (shift.departmentId ? departmentNameById.get(Number(shift.departmentId)) : '') ||
    '';

  if (isNarrow) {
    return (
      <div className="d-flex flex-column gap-3">
        {filteredShifts.length === 0 ? (
          <div className="card">
            <div className="card-body text-center text-muted py-4">
              {t('schedule.noShiftsToDisplay')}
            </div>
          </div>
        ) : (
          weekDates.map((date) => (
            <div className="card" key={date.toISOString()}>
              <div className="card-header fw-semibold">{formatDate(date)}</div>
              <ul className="list-group list-group-flush">
                {filteredShifts.map((shift) => {
                  const deptName = deptNameOf(shift);
                  const dayAssignments = getAssignmentsForDateAndShift(date, shift.id!);
                  const shortBy = (shift.minStaff ?? 0) - dayAssignments.length;
                  return (
                    <li className="list-group-item" key={shift.id}>
                      <div className="d-flex justify-content-between align-items-start gap-2">
                        <small className="text-muted">{`${shift.startTime} - ${shift.endTime}`}</small>
                        {deptName && <span className="badge bg-primary">{deptName}</span>}
                      </div>
                      {dayAssignments.length > 0 ? (
                        <div className="d-flex flex-wrap gap-1 mt-2">
                          {dayAssignments.map((assignment) => {
                            const employee = getEmployeeById(assignment.userId);
                            return (
                              <span key={assignment.id} className="badge bg-success">
                                {employee
                                  ? `${employee.firstName} ${employee.lastName}`
                                  : t('schedule.unknownEmployee')}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-muted mt-2">
                          <i className="bi bi-plus-circle" aria-hidden="true"></i>{' '}
                          <small>{t('schedule.assignStaff')}</small>
                        </div>
                      )}
                      {shortBy > 0 && (
                        <div className="small text-danger mt-1">
                          {t('schedule.needMore', { count: shortBy })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-bordered mb-0">
            <thead>
              <tr>
                <th scope="col" style={{ width: '200px' }}>{t('schedule.shiftColumnHeader')}</th>
                {weekDates.map((date) => (
                  <th scope="col" key={date.toISOString()} className="text-center">
                    {formatDate(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan={weekDates.length + 1} className="text-center text-muted py-4">
                    {t('schedule.noShiftsToDisplay')}
                  </td>
                </tr>
              ) : (
                filteredShifts.map((shift) => {
                  const deptName = deptNameOf(shift);
                  return (
                    <tr key={shift.id}>
                      <td className="align-middle">
                        <div>
                          <strong>{toLocalDateString(shift.date)}</strong>
                          <br />
                          <small className="text-muted">{`${shift.startTime} - ${shift.endTime}`}</small>
                          <br />
                          {deptName && <span className="badge bg-primary">{deptName}</span>}
                        </div>
                      </td>
                      {weekDates.map((date) => {
                        const dayAssignments = getAssignmentsForDateAndShift(date, shift.id!);
                        return (
                          <td key={date.toISOString()} className="align-middle text-center">
                            {dayAssignments.length > 0 ? (
                              <div className="d-flex flex-column gap-1">
                                {dayAssignments.map((assignment) => {
                                  // `userId` is required on the contract, so
                                  // the fallbacks this used to carry could
                                  // never fire: `employeeId` is not a field
                                  // the API returns on an assignment, and
                                  // the empty string stood in for a case
                                  // that cannot arise.
                                  const employee = getEmployeeById(assignment.userId);
                                  return (
                                    <div
                                      key={assignment.id}
                                      className="badge bg-success text-wrap"
                                      style={{ fontSize: '0.75em' }}
                                    >
                                      {employee
                                        ? `${employee.firstName} ${employee.lastName}`
                                        : t('schedule.unknownEmployee')}
                                    </div>
                                  );
                                })}
                                {dayAssignments.length < (shift.minStaff ?? 0) && (
                                  <small className="text-danger">
                                    {t('schedule.needMore', {
                                      count: (shift.minStaff ?? 0) - dayAssignments.length,
                                    })}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <div className="text-muted">
                                <i className="bi bi-plus-circle"></i>
                                <br />
                                <small>{t('schedule.assignStaff')}</small>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WeekView;
