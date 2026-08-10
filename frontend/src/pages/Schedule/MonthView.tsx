/**
 * MonthView — the month grid of the Schedule page: a day-by-day agenda list on
 * narrow viewports, a 6-week calendar table on wide ones. See Schedule.tsx.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../types';
import { toLocalDateString } from '../../utils/format';

// Keyed on Sun–Sat rather than transliterated because the month grid's
// header order is fixed (the grid always starts the week on Sunday), so the
// key just needs to line up positionally — the visible label comes from `t()`.
const WEEKDAY_KEYS = [
  'schedule.weekdays.sun',
  'schedule.weekdays.mon',
  'schedule.weekdays.tue',
  'schedule.weekdays.wed',
  'schedule.weekdays.thu',
  'schedule.weekdays.fri',
  'schedule.weekdays.sat',
];

interface Props {
  isNarrow: boolean;
  monthLoading: boolean;
  monthGridDates: Date[];
  shiftsByDate: Map<string, Shift[]>;
  selectedMonth: Date;
  todayKey: string;
  formatDate: (date: Date) => string;
}

const MonthView: React.FC<Props> = ({
  isNarrow,
  monthLoading,
  monthGridDates,
  shiftsByDate,
  selectedMonth,
  todayKey,
  formatDate,
}) => {
  const { t } = useTranslation();

  const loadingBanner = monthLoading && (
    <div className="d-flex align-items-center justify-content-center py-2 border-bottom small text-muted">
      <span className="spinner-border spinner-border-sm me-2" role="status" aria-label={t('schedule.loadingMonthAriaLabel')}></span>
      {t('common.loading')}
    </div>
  );

  if (isNarrow) {
    return (
      <div className="card">
        <div className="card-body">
          {loadingBanner}
          <div className="d-flex flex-column gap-2">
            {monthGridDates
              .filter((date) => date.getMonth() === selectedMonth.getMonth())
              .map((date) => {
                const dateKey = toLocalDateString(date);
                const dayShifts = shiftsByDate.get(dateKey) ?? [];
                const isToday = dateKey === todayKey;
                return (
                  <div className={`card ${isToday ? 'border-primary' : ''}`} key={dateKey}>
                    <div className="card-body py-2">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span className="fw-semibold">{formatDate(date)}</span>
                        {dayShifts.length > 0 && (
                          <span
                            className="badge bg-secondary"
                            aria-label={t('schedule.shiftsCountAriaLabel', { count: dayShifts.length })}
                          >
                            {dayShifts.length}
                          </span>
                        )}
                      </div>
                      {dayShifts.length === 0 ? (
                        <div className="text-muted small">{t('schedule.noShifts')}</div>
                      ) : (
                        <div className="d-flex flex-column gap-1">
                          {dayShifts.map((shift) => (
                            <div key={shift.id} className="small">
                              <span className="badge bg-primary-subtle text-primary-emphasis">
                                {t('common.timeRange', { start: shift.startTime, end: shift.endTime })}
                              </span>{' '}
                              {shift.departmentName ?? ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body p-0">
        {loadingBanner}
        <div className="table-responsive">
          <table className="table table-bordered mb-0" role="table" aria-label={t('schedule.monthlyCalendarAriaLabel')}>
            <thead>
              <tr>
                {WEEKDAY_KEYS.map((key) => (
                  <th key={key} className="text-center small text-muted" scope="col">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, week) => (
                <tr key={week} style={{ height: '110px' }}>
                  {monthGridDates.slice(week * 7, week * 7 + 7).map((date) => {
                    const dateKey = toLocalDateString(date);
                    const dayShifts = shiftsByDate.get(dateKey) ?? [];
                    const isCurrentMonth = date.getMonth() === selectedMonth.getMonth();
                    const isToday = dateKey === todayKey;
                    return (
                      <td
                        key={dateKey}
                        className={`align-top ${isCurrentMonth ? '' : 'bg-body-tertiary'}`}
                        style={{ width: '14.28%', verticalAlign: 'top' }}
                      >
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <span
                            className={`small ${isCurrentMonth ? 'fw-semibold' : 'text-muted'}`}
                            style={isToday ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'var(--bs-primary)', color: '#fff' } : undefined}
                          >
                            {date.getDate()}
                          </span>
                          {dayShifts.length > 0 && (
                            <span
                              className="badge bg-secondary"
                              aria-label={t('schedule.shiftsCountAriaLabel', { count: dayShifts.length })}
                            >
                              {dayShifts.length}
                            </span>
                          )}
                        </div>
                        <div className="d-flex flex-column gap-1">
                          {dayShifts.slice(0, 3).map((shift) => (
                            <span
                              key={shift.id}
                              className="badge bg-primary-subtle text-primary-emphasis text-truncate d-block text-start"
                              title={
                                shift.departmentName
                                  ? t('schedule.monthDayTitle', {
                                      time: t('common.timeRange', {
                                        start: shift.startTime,
                                        end: shift.endTime,
                                      }),
                                      department: shift.departmentName,
                                    })
                                  : t('common.timeRange', { start: shift.startTime, end: shift.endTime })
                              }
                            >
                              {shift.startTime} {shift.departmentName ?? ''}
                            </span>
                          ))}
                          {dayShifts.length > 3 && (
                            <span className="small text-muted">
                              {t('schedule.moreCount', { count: dayShifts.length - 3 })}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MonthView;
