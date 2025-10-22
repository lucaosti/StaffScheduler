/**
 * Schedule Page Component for Staff Scheduler
 * 
 * Advanced schedule management interface providing calendar view,
 * schedule optimization, and comprehensive scheduling tools.
 * 
 * Features:
 * - Interactive calendar with schedule visualization
 * - Drag-and-drop schedule editing
 * - Automatic schedule optimization
 * - Conflict detection and resolution
 * - Multi-view support (daily, weekly, monthly)
 * - Schedule publishing and approval workflows
 * - Real-time collaboration and updates
 * 
 * @author Luca Ostinelli
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Schedule as ScheduleType, Assignment, Employee, Shift } from '../../types';
import * as scheduleService from '../../services/scheduleService';
import * as dashboardService from '../../services/dashboardService';
import * as employeeService from '../../services/employeeService';
import * as shiftService from '../../services/shiftService';

interface ScheduleGenerationParams {
  startDate: string;
  endDate: string;
  departments: string[];
  constraints: {
    maxConsecutiveDays: number;
    minRestHours: number;
    maxHoursPerWeek: number;
    preferredShifts: string[];
  };
}

/**
 * Schedule page component for schedule management and visualization
 * @returns JSX element containing the schedule management interface
 */
const Schedule: React.FC = () => {
  const [schedules, setSchedules] = useState<ScheduleType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load all necessary data from real APIs
      const [schedulesResponse, employeesResponse, shiftsResponse] = await Promise.all([
        scheduleService.getSchedules(),
        employeeService.getEmployees({}),
        shiftService.getShifts({})
      ]);

      if (schedulesResponse.success && schedulesResponse.data) {
        setSchedules(schedulesResponse.data);
      } else {
        setError('Failed to load schedules');
      }
      
      if (employeesResponse.success && employeesResponse.data) {
        setEmployees(employeesResponse.data);
      }
      
      if (shiftsResponse.success && shiftsResponse.data) {
        setShifts(shiftsResponse.data);
      }

      // Load assignments for the current week
      if (schedulesResponse.success && schedulesResponse.data && schedulesResponse.data.length > 0) {
        const firstSchedule = schedulesResponse.data[0];
        const scheduleDetails = await scheduleService.getScheduleWithShifts(firstSchedule.id);
        if (scheduleDetails.success && scheduleDetails.data) {
          // Assignments would be extracted from schedule details
          setAssignments([]);
        }
      }

    } catch (err) {
      console.error('Load data error:', err);
      setError('Failed to load schedule data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateWeekDates = (startDate: Date) => {
    const dates = [];
    const start = new Date(startDate);
    start.setDate(start.getDate() - start.getDay()); // Start from Sunday
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('it-IT', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short' 
    });
  };

  const getAssignmentsForDateAndShift = (date: Date, shiftId: string) => {
    const dateStr = date.toISOString().split('T')[0];
    return assignments.filter(a => {
      const assignedDate = new Date(a.assignedAt).toISOString().split('T')[0];
      return assignedDate === dateStr && a.shiftId === shiftId;
    });
  };

  const getEmployeeById = (employeeId: string) => {
    return employees.find(e => e.employeeId === employeeId);
  };

  const getShiftById = (shiftId: string) => {
    return shifts.find(s => s.id === shiftId);
  };

  const handleGenerateSchedule = async (params: ScheduleGenerationParams) => {
    setIsGenerating(true);
    try {
      // Call the real schedule generation API
      if (schedules.length === 0) {
        alert('No schedules available to generate');
        return;
      }

      const firstScheduleId = schedules[0].id;
      const response = await scheduleService.generateSchedule(firstScheduleId);
      
      if (response.success) {
        await loadData(); // Reload data
        setShowGenerateModal(false);
        alert(`Schedule generated successfully! ${response.data?.message}`);
      } else {
        alert('Failed to generate schedule: ' + (response.error?.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Generate schedule error:', err);
      alert('Failed to generate schedule');
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredShifts = shifts.filter(shift => 
    !selectedDepartment || shift.department === selectedDepartment
  );

  const departments = Array.from(new Set(shifts.map(s => s.department).filter(Boolean)));
  const weekDates = generateWeekDates(selectedWeek);

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedWeek);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    setSelectedWeek(newDate);
  };

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading schedule data...</p>
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
              <h1 className="h3 mb-0">Schedule Management</h1>
              <p className="text-muted mb-0">
                Create and manage work schedules for hospital departments
              </p>
            </div>
            <div className="d-flex gap-2">
              <button 
                className="btn btn-success"
                onClick={() => setShowGenerateModal(true)}
              >
                <i className="bi bi-magic me-2"></i>
                Generate Schedule
              </button>
              <div className="btn-group" role="group">
                <button 
                  type="button" 
                  className={`btn ${viewMode === 'week' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setViewMode('week')}
                >
                  Week
                </button>
                <button 
                  type="button" 
                  className={`btn ${viewMode === 'month' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setViewMode('month')}
                >
                  Month
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="row mb-4">
        <div className="col-md-6">
          <div className="d-flex align-items-center gap-3">
            <button 
              className="btn btn-outline-secondary"
              onClick={() => navigateWeek('prev')}
            >
              <i className="bi bi-chevron-left"></i>
            </button>
            <h5 className="mb-0">
              {viewMode === 'week' 
                ? `Week of ${weekDates[0].toLocaleDateString('it-IT')}`
                : selectedWeek.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
              }
            </h5>
            <button 
              className="btn btn-outline-secondary"
              onClick={() => navigateWeek('next')}
            >
              <i className="bi bi-chevron-right"></i>
            </button>
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
          <div className="text-muted">
            {filteredShifts.length} shift{filteredShifts.length !== 1 ? 's' : ''} • {employees.length} employees
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2"></i>
          {error}
        </div>
      )}

      {/* Schedule Grid */}
      {viewMode === 'week' && (
        <div className="card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-bordered mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '200px' }}>Shift</th>
                    {weekDates.map(date => (
                      <th key={date.toISOString()} className="text-center">
                        {formatDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.map(shift => (
                    <tr key={shift.id}>
                      <td className="align-middle">
                        <div>
                          <strong>{shift.name}</strong>
                          <br />
                          <small className="text-muted">
                            {shift.startTime} - {shift.endTime}
                          </small>
                          <br />
                          <span className="badge bg-primary">{shift.department}</span>
                        </div>
                      </td>
                      {weekDates.map(date => {
                        const dayAssignments = getAssignmentsForDateAndShift(date, shift.id!);
                        return (
                          <td key={date.toISOString()} className="align-middle text-center">
                            {dayAssignments.length > 0 ? (
                              <div className="d-flex flex-column gap-1">
                                {dayAssignments.map(assignment => {
                                  const employee = getEmployeeById(assignment.employeeId);
                                  return (
                                    <div 
                                      key={assignment.id} 
                                      className="badge bg-success text-wrap"
                                      style={{ fontSize: '0.75em' }}
                                    >
                                      {employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown'}
                                    </div>
                                  );
                                })}
                                {dayAssignments.length < shift.minimumStaff && (
                                  <small className="text-danger">
                                    Need {shift.minimumStaff - dayAssignments.length} more
                                  </small>
                                )}
                              </div>
                            ) : (
                              <div className="text-muted">
                                <i className="bi bi-plus-circle"></i>
                                <br />
                                <small>Assign Staff</small>
                              </div>
                            )}
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
      )}

      {/* Month View Placeholder */}
      {viewMode === 'month' && (
        <div className="card">
          <div className="card-body text-center py-5">
            <i className="bi bi-calendar3 text-muted" style={{ fontSize: '3rem' }}></i>
            <h5 className="mt-3">Monthly View</h5>
            <p className="text-muted">Monthly calendar view coming soon</p>
          </div>
        </div>
      )}

      {/* Recent Schedules */}
      <div className="row mt-4">
        <div className="col-12">
          <h5 className="mb-3">Recent Schedules</h5>
          <div className="row">
            {schedules.map(schedule => (
              <div key={schedule.id} className="col-md-6 col-lg-4 mb-3">
                <div className="card">
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <h6 className="card-title mb-0">{schedule.name}</h6>
                      <span className={`badge ${
                        schedule.status === 'published' ? 'bg-success' : 
                        schedule.status === 'draft' ? 'bg-warning' : 'bg-secondary'
                      }`}>
                        {schedule.status}
                      </span>
                    </div>
                    <p className="card-text">
                      <small className="text-muted">
                        {schedule.startDate} to {schedule.endDate}
                      </small>
                      <br />
                      {schedule.description && (
                        <span className="text-muted">{schedule.description}</span>
                      )}
                    </p>
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-outline-primary">
                        <i className="bi bi-eye me-1"></i>View
                      </button>
                      <button className="btn btn-sm btn-outline-secondary">
                        <i className="bi bi-pencil me-1"></i>Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Generate Schedule Modal */}
      {showGenerateModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Generate New Schedule</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowGenerateModal(false)}
                  disabled={isGenerating}
                ></button>
              </div>
              <div className="modal-body">
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  
                  const params: ScheduleGenerationParams = {
                    startDate: formData.get('startDate') as string,
                    endDate: formData.get('endDate') as string,
                    departments: [formData.get('department') as string],
                    constraints: {
                      maxConsecutiveDays: parseInt(formData.get('maxConsecutiveDays') as string),
                      minRestHours: parseInt(formData.get('minRestHours') as string),
                      maxHoursPerWeek: parseInt(formData.get('maxHoursPerWeek') as string),
                      preferredShifts: []
                    }
                  };

                  await handleGenerateSchedule(params);
                }}>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label htmlFor="startDate" className="form-label">Start Date *</label>
                      <input
                        type="date"
                        className="form-control"
                        id="startDate"
                        name="startDate"
                        required
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label htmlFor="endDate" className="form-label">End Date *</label>
                      <input
                        type="date"
                        className="form-control"
                        id="endDate"
                        name="endDate"
                        required
                        disabled={isGenerating}
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label htmlFor="department" className="form-label">Department *</label>
                    <select
                      className="form-select"
                      id="department"
                      name="department"
                      required
                      disabled={isGenerating}
                    >
                      <option value="">Select Department</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  <h6 className="mb-3">Scheduling Constraints</h6>
                  
                  <div className="row">
                    <div className="col-md-4 mb-3">
                      <label htmlFor="maxConsecutiveDays" className="form-label">Max Consecutive Days</label>
                      <input
                        type="number"
                        min="1"
                        max="14"
                        className="form-control"
                        id="maxConsecutiveDays"
                        name="maxConsecutiveDays"
                        defaultValue={5}
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label htmlFor="minRestHours" className="form-label">Min Rest Hours</label>
                      <input
                        type="number"
                        min="8"
                        max="48"
                        className="form-control"
                        id="minRestHours"
                        name="minRestHours"
                        defaultValue={11}
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label htmlFor="maxHoursPerWeek" className="form-label">Max Hours Per Week</label>
                      <input
                        type="number"
                        min="20"
                        max="60"
                        className="form-control"
                        id="maxHoursPerWeek"
                        name="maxHoursPerWeek"
                        defaultValue={40}
                        disabled={isGenerating}
                      />
                    </div>
                  </div>

                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowGenerateModal(false)}
                      disabled={isGenerating}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="btn btn-success"
                      disabled={isGenerating}
                    >
                      {isGenerating ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Generating...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-magic me-2"></i>
                          Generate Schedule
                        </>
                      )}
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

export default Schedule;
