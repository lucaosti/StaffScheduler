/**
 * Everything that can leave this system as a file, in one place.
 *
 * WHY ONE FILE RATHER THAN A DEFINITION BESIDE EACH ROUTE. The question this
 * file answers is "what data can be exported, and which fields does each export
 * publish?" — a question about the system as a whole, most often asked by
 * someone reviewing what a departing manager could have taken with them.
 * Answered by eight definitions in eight route files, it is answered wrongly:
 * the reader finds seven and concludes.
 *
 * WHY THE COLUMNS ARE EXPLICIT AND NOT THE ROW OBJECT. Serializing whatever the
 * service returned would publish every field it happens to select today, and
 * would keep publishing every field added later — `password_hash` is not in
 * these shapes, but `hourlyRate` is, and an export of "employees" that quietly
 * grew a salary column is the kind of disclosure nobody decided to make. Listing
 * the columns means a field is exported because someone chose to export it.
 *
 * Headers are human-readable rather than the API's camelCase, because the
 * consumer of a CSV is a spreadsheet a person is reading, not a parser. Column
 * ORDER is the reading order of the underlying screen, so the file resembles the
 * table it came from.
 *
 * @author Luca Ostinelli
 */

import type { Shift, ShiftAssignment, User } from '../types';
import type { CostByDepartmentRow, HoursWorkedRow } from './ReportsService';
import type { CsvColumn } from '../utils/csv';

/** `HH:MM` from a `HH:MM:SS` time column, left alone if already short. */
const shortTime = (value: string | undefined): string => (value ? value.slice(0, 5) : '');

/**
 * A date column as its calendar date.
 *
 * MySQL DATE columns arrive as `YYYY-MM-DD` strings, but a DATETIME arrives with
 * a time, and the driver may hand back a `Date` — so a shift's date is sliced
 * rather than assumed short. The same trap the frontend has on the other side:
 * formatting a `Date` through UTC would move a European date back a day.
 */
const dateOnly = (value: string | Date | undefined | null): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Also the fairness export's columns, deliberately and not by accident.
 *
 * The fairness report exports its per-user breakdown, not its summary
 * statistics: a CSV of one row holding min/max/mean/stddev is not something
 * anyone opens a spreadsheet for, whereas sorting people by hours to see who is
 * at the ends is exactly why they would. That breakdown IS hours-per-user, so it
 * reuses this list rather than declaring a second identical one — an alias would
 * only invite the two to drift.
 */
export const hoursWorkedColumns: readonly CsvColumn<HoursWorkedRow>[] = [
  { header: 'Employee ID', value: (r) => r.userId },
  { header: 'Employee', value: (r) => r.fullName },
  { header: 'Hours', value: (r) => r.hours },
];

export const costByDepartmentColumns: readonly CsvColumn<CostByDepartmentRow>[] = [
  { header: 'Department ID', value: (r) => r.departmentId },
  { header: 'Department', value: (r) => r.departmentName },
  { header: 'Hours', value: (r) => r.hours },
  { header: 'Cost', value: (r) => r.cost },
];

export const employeeColumns: readonly CsvColumn<User>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Employee Number', value: (r) => r.employeeId },
  { header: 'First Name', value: (r) => r.firstName },
  { header: 'Last Name', value: (r) => r.lastName },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Position', value: (r) => r.position },
  { header: 'Department', value: (r) => r.department },
  { header: 'Active', value: (r) => (r.isActive ? 'yes' : 'no') },
];

export const shiftColumns: readonly CsvColumn<Shift>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Date', value: (r) => dateOnly(r.date as unknown as string | Date) },
  { header: 'Start', value: (r) => shortTime(r.startTime) },
  { header: 'End', value: (r) => shortTime(r.endTime) },
  { header: 'Department', value: (r) => r.departmentName ?? r.departmentId },
  { header: 'Schedule', value: (r) => r.scheduleName ?? r.scheduleId },
  { header: 'Min Staff', value: (r) => r.minStaff },
  { header: 'Max Staff', value: (r) => r.maxStaff },
  { header: 'Assigned', value: (r) => r.assignedStaff },
  { header: 'Status', value: (r) => r.status },
  { header: 'Notes', value: (r) => r.notes },
];

export const assignmentColumns: readonly CsvColumn<ShiftAssignment>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Date', value: (r) => dateOnly(r.shiftDate as unknown as string | Date) },
  { header: 'Start', value: (r) => shortTime(r.startTime) },
  { header: 'End', value: (r) => shortTime(r.endTime) },
  { header: 'Employee', value: (r) => r.userName ?? r.userId },
  { header: 'Email', value: (r) => r.userEmail },
  { header: 'Department', value: (r) => r.departmentName ?? r.departmentId },
  { header: 'Status', value: (r) => r.status },
  { header: 'Assigned At', value: (r) => r.assignedAt },
  { header: 'Confirmed At', value: (r) => r.confirmedAt },
];

/** Shapes the attendance and time-off services return; both are module-local there. */
interface AttendanceExportRow {
  id: number;
  userId: number;
  shiftAssignmentId: number | null;
  clockIn: string;
  clockOut: string | null;
  status: string;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  notes: string | null;
}

export const attendanceColumns: readonly CsvColumn<AttendanceExportRow>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Employee ID', value: (r) => r.userId },
  { header: 'Assignment ID', value: (r) => r.shiftAssignmentId },
  { header: 'Clock In', value: (r) => r.clockIn },
  { header: 'Clock Out', value: (r) => r.clockOut },
  { header: 'Status', value: (r) => r.status },
  { header: 'Reviewer ID', value: (r) => r.reviewerId },
  { header: 'Reviewed At', value: (r) => r.reviewedAt },
  { header: 'Review Notes', value: (r) => r.reviewNotes },
  { header: 'Notes', value: (r) => r.notes },
];

interface TimeOffExportRow {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  type: string;
  reason: string | null;
  status: string;
  reviewerId: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  unavailabilityId: number | null;
}

export const timeOffColumns: readonly CsvColumn<TimeOffExportRow>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Employee ID', value: (r) => r.userId },
  { header: 'Start Date', value: (r) => dateOnly(r.startDate) },
  { header: 'End Date', value: (r) => dateOnly(r.endDate) },
  { header: 'Type', value: (r) => r.type },
  { header: 'Status', value: (r) => r.status },
  { header: 'Reason', value: (r) => r.reason },
  { header: 'Reviewer ID', value: (r) => r.reviewerId },
  { header: 'Reviewed At', value: (r) => r.reviewedAt },
  { header: 'Review Notes', value: (r) => r.reviewNotes },
  // An approved request only frees the person once it has produced an
  // unavailability row; the export says which, for the same reason the UI does.
  { header: 'Recorded As Unavailable', value: (r) => (r.unavailabilityId ? 'yes' : 'no') },
];
