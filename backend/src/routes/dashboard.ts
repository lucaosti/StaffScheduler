/**
 * Dashboard Routes
 * 
 * Provides dashboard data and analytics endpoints for the application.
 * Includes statistics, metrics, and real-time information display.
 * 
 * Features:
 * - Real-time statistics and KPIs
 * - Department-specific metrics
 * - Monthly performance analytics
 * - Trend analysis and reporting
 * 
 * @author Luca Ostinelli
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { database } from '../config/database';
import { logger } from '../config/logger';

const router = Router();

/**
 * Get Dashboard Statistics Endpoint
 * 
 * Retrieves key performance indicators and statistics for the dashboard.
 * Provides real-time data for administrative oversight.
 * 
 * @route GET /api/dashboard/stats
 * @returns {Object} Dashboard statistics and KPIs
 */
router.get('/stats', authenticate, async (req: Request, res: Response) => {
  try {
    // Get basic statistics
    const totalEmployeesQuery = 'SELECT COUNT(*) as count FROM employees WHERE is_active = true';
    const totalEmployees = await database.queryOne<{ count: number }>(totalEmployeesQuery);

    const activeSchedulesQuery = 'SELECT COUNT(*) as count FROM schedules WHERE status = "published"';
    const activeSchedules = await database.queryOne<{ count: number }>(activeSchedulesQuery);

    const todayShiftsQuery = `
      SELECT COUNT(*) as count 
      FROM shifts 
      WHERE DATE(date) = CURDATE() AND status = 'published'
    `;
    const todayShifts = await database.queryOne<{ count: number }>(todayShiftsQuery);

    const pendingApprovalsQuery = `
      SELECT COUNT(*) as count 
      FROM assignments 
      WHERE status = 'pending'
    `;
    const pendingApprovals = await database.queryOne<{ count: number }>(pendingApprovalsQuery);

    // Calculate monthly hours from assignments
    const monthlyHoursQuery = `
      SELECT COALESCE(SUM(TIMESTAMPDIFF(HOUR, 
        CONCAT(s.shift_date, ' ', s.start_time),
        CONCAT(s.shift_date, ' ', s.end_time)
      )), 0) as total_hours
      FROM shift_assignments sa
      JOIN shifts s ON sa.shift_id = s.id
      WHERE MONTH(s.shift_date) = MONTH(CURDATE())
        AND YEAR(s.shift_date) = YEAR(CURDATE())
        AND sa.status = 'confirmed'
    `;
    const monthlyHoursResult = await database.queryOne<{ total_hours: number }>(monthlyHoursQuery);
    const monthlyHours = monthlyHoursResult?.total_hours || 0;

    // Calculate monthly cost from employee hourly rates
    const monthlyCostQuery = `
      SELECT COALESCE(SUM(
        TIMESTAMPDIFF(HOUR, 
          CONCAT(s.shift_date, ' ', s.start_time),
          CONCAT(s.shift_date, ' ', s.end_time)
        ) * e.hourly_rate
      ), 0) as total_cost
      FROM shift_assignments sa
      JOIN shifts s ON sa.shift_id = s.id
      JOIN employees e ON sa.employee_id = e.id
      WHERE MONTH(s.shift_date) = MONTH(CURDATE())
        AND YEAR(s.shift_date) = YEAR(CURDATE())
        AND sa.status = 'confirmed'
    `;
    const monthlyCostResult = await database.queryOne<{ total_cost: number }>(monthlyCostQuery);
    const monthlyCost = monthlyCostResult?.total_cost || 0;

    // Calculate coverage rate (percentage of shifts that are filled)
    const coverageQuery = `
      SELECT 
        COUNT(DISTINCT s.id) as total_shifts,
        COUNT(DISTINCT CASE WHEN sa.id IS NOT NULL THEN s.id END) as covered_shifts
      FROM shifts s
      LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status = 'confirmed'
      WHERE MONTH(s.shift_date) = MONTH(CURDATE())
        AND YEAR(s.shift_date) = YEAR(CURDATE())
    `;
    const coverageResult = await database.queryOne<{ total_shifts: number; covered_shifts: number }>(coverageQuery);
    const coverageRate = coverageResult && coverageResult.total_shifts > 0
      ? (coverageResult.covered_shifts / coverageResult.total_shifts) * 100
      : 0;

    // Calculate employee satisfaction (based on preference matches)
    const satisfactionQuery = `
      SELECT 
        COUNT(*) as total_assignments,
        SUM(CASE WHEN ep.preference_type = 'preferred' THEN 1 ELSE 0 END) as preferred_matches
      FROM shift_assignments sa
      JOIN shifts s ON sa.shift_id = s.id
      LEFT JOIN employee_preferences ep ON sa.employee_id = ep.employee_id 
        AND s.shift_type = ep.shift_type
      WHERE MONTH(s.shift_date) = MONTH(CURDATE())
        AND YEAR(s.shift_date) = YEAR(CURDATE())
        AND sa.status = 'confirmed'
    `;
    const satisfactionResult = await database.queryOne<{ total_assignments: number; preferred_matches: number }>(satisfactionQuery);
    const employeeSatisfaction = satisfactionResult && satisfactionResult.total_assignments > 0
      ? (satisfactionResult.preferred_matches / satisfactionResult.total_assignments) * 100
      : 0;

    const stats = {
      totalEmployees: totalEmployees?.count || 0,
      activeSchedules: activeSchedules?.count || 0,
      todayShifts: todayShifts?.count || 0,
      pendingApprovals: pendingApprovals?.count || 0,
      monthlyHours: Math.round(monthlyHours),
      monthlyCost: Math.round(monthlyCost * 100) / 100,
      coverageRate: Math.round(coverageRate * 10) / 10,
      employeeSatisfaction: Math.round(employeeSatisfaction * 10) / 10
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch dashboard statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// Get recent activities
router.get('/activities', authenticate, async (req: Request, res: Response) => {
  try {
    // Fetch real activities from audit_logs table
    const activitiesQuery = `
      SELECT 
        al.id,
        al.action as type,
        al.description as message,
        al.created_at as timestamp,
        CONCAT(u.first_name, ' ', u.last_name) as user
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 10
    `;
    
    const activities = await database.query<{
      id: number;
      type: string;
      message: string;
      timestamp: Date;
      user: string | null;
    }>(activitiesQuery);

    // Format activities for response
    const formattedActivities = activities.map(activity => ({
      id: activity.id.toString(),
      type: activity.type,
      message: activity.message,
      timestamp: activity.timestamp.toISOString(),
      user: activity.user || 'System'
    }));

    res.json({
      success: true,
      data: formattedActivities
    });
  } catch (error) {
    logger.error('Dashboard activities error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to load recent activities',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// Get upcoming shifts
router.get('/upcoming-shifts', authenticate, async (req: Request, res: Response) => {
  try {
    // Query upcoming shifts with assignment information (using correct schema)
    const query = `
      SELECT 
        s.id,
        CONCAT(d.name, ' - ', DATE_FORMAT(s.date, '%Y-%m-%d')) as name,
        d.name as department,
        s.start_time,
        s.end_time,
        s.min_staff as required_employees,
        COUNT(sa.id) as assigned_employees
      FROM shifts s
      JOIN departments d ON s.department_id = d.id
      LEFT JOIN shift_assignments sa ON s.id = sa.shift_id AND sa.status IN ('pending', 'confirmed')
      WHERE s.date >= CURDATE() AND s.date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        AND s.status IN ('open', 'assigned', 'confirmed')
      GROUP BY s.id, d.name, s.date, s.start_time, s.end_time, s.min_staff
      ORDER BY s.date, s.start_time
      LIMIT 10
    `;

    const rows = await database.query<{
      id: number;
      name: string;
      department: string;
      start_time: string;
      end_time: string;
      required_employees: number;
      assigned_employees: number;
    }>(query);
    
    const upcomingShifts = rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      department: row.department,
      startTime: row.start_time,
      endTime: row.end_time,
      assignedEmployees: row.assigned_employees || 0,
      requiredEmployees: row.required_employees,
      status: row.assigned_employees < row.required_employees ? 'understaffed' :
              row.assigned_employees > row.required_employees ? 'overstaffed' : 'adequate'
    }));

    res.json({
      success: true,
      data: upcomingShifts
    });
  } catch (error) {
    logger.error('Dashboard upcoming shifts error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to load upcoming shifts',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// Get department overview
router.get('/departments', authenticate, async (req: Request, res: Response) => {
  try {
    // Query department statistics using correct schema (departments + users + user_departments)
    const query = `
      SELECT 
        d.name as department,
        COUNT(DISTINCT u.id) as total_employees,
        COUNT(DISTINCT CASE WHEN u.is_active = TRUE THEN u.id END) as active_employees,
        COUNT(DISTINCT CASE WHEN u.role = 'employee' THEN u.id END) as employee_count,
        COUNT(DISTINCT CASE WHEN u.role = 'manager' THEN u.id END) as manager_count
      FROM departments d
      LEFT JOIN user_departments ud ON d.id = ud.department_id
      LEFT JOIN users u ON ud.user_id = u.id
      WHERE d.is_active = TRUE
      GROUP BY d.id, d.name
      ORDER BY total_employees DESC
    `;

    const departments = await database.query<{
      department: string;
      total_employees: number;
      active_employees: number;
      employee_count: number;
      manager_count: number;
    }>(query);
    
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    logger.error('Dashboard departments error:', error);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to load department overview',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

export default router;
