import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Schedule, CreateScheduleRequest, UpdateScheduleRequest } from '../types';

export class ScheduleService {
  constructor(private pool: Pool) {}

  async getAllSchedules(): Promise<Schedule[]> {
    const query = `
      SELECT 
        s.schedule_id as id,
        s.name,
        s.start_date as startDate,
        s.end_date as endDate,
        s.status,
        s.department_id as departmentId,
        s.created_by as createdBy,
        s.created_at as createdAt,
        s.updated_at as updatedAt,
        d.name as departmentName,
        u.first_name as createdByFirstName,
        u.last_name as createdByLastName,
        COUNT(sh.shift_id) as shiftCount
      FROM schedules s
      LEFT JOIN departments d ON s.department_id = d.department_id
      LEFT JOIN users u ON s.created_by = u.user_id
      LEFT JOIN shifts sh ON s.schedule_id = sh.schedule_id
      GROUP BY s.schedule_id
      ORDER BY s.created_at DESC
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      departmentId: row.departmentId,
      createdBy: row.createdBy,
      shifts: [], // Will be loaded separately if needed
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getScheduleById(id: number): Promise<Schedule | null> {
    const query = `
      SELECT 
        s.schedule_id as id,
        s.name,
        s.start_date as startDate,
        s.end_date as endDate,
        s.status,
        s.department_id as departmentId,
        s.created_by as createdBy,
        s.created_at as createdAt,
        s.updated_at as updatedAt
      FROM schedules s
      WHERE s.schedule_id = ?
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      departmentId: row.departmentId,
      createdBy: row.createdBy,
      shifts: [], // Will be loaded separately if needed
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async createSchedule(scheduleData: CreateScheduleRequest, createdBy: number): Promise<number> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const query = `
        INSERT INTO schedules (
          name, start_date, end_date, department_id, created_by, status
        ) VALUES (?, ?, ?, ?, ?, 'draft')
      `;
      
      const [result] = await connection.execute<ResultSetHeader>(query, [
        scheduleData.name,
        scheduleData.startDate,
        scheduleData.endDate,
        scheduleData.departmentId || null,
        createdBy
      ]);

      const scheduleId = result.insertId;

      // Create shifts from templates if provided
      if (scheduleData.templateIds?.length) {
        // Get template details
        const templateQuery = `
          SELECT * FROM shift_templates WHERE template_id IN (${scheduleData.templateIds.map(() => '?').join(',')})
        `;
        const [templates] = await connection.execute<RowDataPacket[]>(templateQuery, scheduleData.templateIds);

        // Generate shifts for each day in the schedule period
        const startDate = new Date(scheduleData.startDate);
        const endDate = new Date(scheduleData.endDate);
        
        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
          for (const template of templates) {
            const shiftQuery = `
              INSERT INTO shifts (
                schedule_id, template_id, shift_date, start_time, end_time, 
                required_staff, department_id, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
            `;
            
            const [shiftResult] = await connection.execute<ResultSetHeader>(shiftQuery, [
              scheduleId,
              template.template_id,
              date.toISOString().split('T')[0],
              template.start_time,
              template.end_time,
              template.required_staff,
              template.department_id
            ]);

            // Add required skills for the shift
            const skillsQuery = `
              SELECT skill_id FROM shift_template_skills WHERE template_id = ?
            `;
            const [skills] = await connection.execute<RowDataPacket[]>(skillsQuery, [template.template_id]);
            
            for (const skill of skills) {
              await connection.execute(
                'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
                [shiftResult.insertId, skill.skill_id]
              );
            }
          }
        }
      }

      await connection.commit();
      return scheduleId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateSchedule(id: number, scheduleData: UpdateScheduleRequest): Promise<boolean> {
    const updates: string[] = [];
    const values: any[] = [];
    
    if (scheduleData.name !== undefined) {
      updates.push('name = ?');
      values.push(scheduleData.name);
    }
    if (scheduleData.startDate !== undefined) {
      updates.push('start_date = ?');
      values.push(scheduleData.startDate);
    }
    if (scheduleData.endDate !== undefined) {
      updates.push('end_date = ?');
      values.push(scheduleData.endDate);
    }
    if (scheduleData.status !== undefined) {
      updates.push('status = ?');
      values.push(scheduleData.status);
    }
    if (scheduleData.departmentId !== undefined) {
      updates.push('department_id = ?');
      values.push(scheduleData.departmentId);
    }
    
    if (updates.length === 0) return false;
    
    values.push(id);
    const query = `UPDATE schedules SET ${updates.join(', ')} WHERE schedule_id = ?`;
    
    const [result] = await this.pool.execute<ResultSetHeader>(query, values);
    return result.affectedRows > 0;
  }

  async deleteSchedule(id: number): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if schedule has assignments
      const [assignmentRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as count 
         FROM assignments a 
         INNER JOIN shifts s ON a.shift_id = s.shift_id 
         WHERE s.schedule_id = ?`, 
        [id]
      );
      
      if (assignmentRows[0].count > 0) {
        throw new Error('Cannot delete schedule with existing assignments');
      }

      // Delete shifts first
      await connection.execute('DELETE FROM shifts WHERE schedule_id = ?', [id]);
      
      // Delete schedule
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM schedules WHERE schedule_id = ?', 
        [id]
      );

      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getSchedulesByDepartment(departmentId: number): Promise<Schedule[]> {
    const query = `
      SELECT 
        s.schedule_id as id,
        s.name,
        s.start_date as startDate,
        s.end_date as endDate,
        s.status,
        s.department_id as departmentId,
        s.created_by as createdBy,
        s.created_at as createdAt,
        s.updated_at as updatedAt,
        COUNT(sh.shift_id) as shiftCount
      FROM schedules s
      LEFT JOIN shifts sh ON s.schedule_id = sh.schedule_id
      WHERE s.department_id = ? OR s.department_id IS NULL
      GROUP BY s.schedule_id
      ORDER BY s.created_at DESC
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [departmentId]);
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      departmentId: row.departmentId,
      createdBy: row.createdBy,
      shifts: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getSchedulesByUser(userId: number): Promise<Schedule[]> {
    const query = `
      SELECT 
        s.schedule_id as id,
        s.name,
        s.start_date as startDate,
        s.end_date as endDate,
        s.status,
        s.department_id as departmentId,
        s.created_by as createdBy,
        s.created_at as createdAt,
        s.updated_at as updatedAt
      FROM schedules s
      WHERE s.created_by = ?
      ORDER BY s.created_at DESC
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [userId]);
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      departmentId: row.departmentId,
      createdBy: row.createdBy,
      shifts: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async publishSchedule(id: number): Promise<boolean> {
    const query = 'UPDATE schedules SET status = ? WHERE schedule_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, ['published', id]);
    return result.affectedRows > 0;
  }

  async archiveSchedule(id: number): Promise<boolean> {
    const query = 'UPDATE schedules SET status = ? WHERE schedule_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, ['archived', id]);
    return result.affectedRows > 0;
  }

  async getScheduleWithShifts(id: number): Promise<Schedule | null> {
    const schedule = await this.getScheduleById(id);
    if (!schedule) return null;

    // Get shifts for this schedule
    const shiftsQuery = `
      SELECT 
        s.shift_id as id,
        s.schedule_id as scheduleId,
        s.template_id as templateId,
        s.shift_date as date,
        s.start_time as startTime,
        s.end_time as endTime,
        s.required_staff as requiredStaff,
        s.department_id as departmentId,
        s.status,
        s.created_at as createdAt,
        s.updated_at as updatedAt,
        COUNT(a.assignment_id) as assignedStaff
      FROM shifts s
      LEFT JOIN assignments a ON s.shift_id = a.shift_id AND a.status IN ('scheduled', 'confirmed')
      WHERE s.schedule_id = ?
      GROUP BY s.shift_id
      ORDER BY s.shift_date, s.start_time
    `;
    
    const [shiftRows] = await this.pool.execute<RowDataPacket[]>(shiftsQuery, [id]);
    schedule.shifts = shiftRows.map(row => ({
      id: row.id,
      scheduleId: row.scheduleId,
      templateId: row.templateId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      requiredStaff: row.requiredStaff,
      assignedStaff: row.assignedStaff,
      departmentId: row.departmentId,
      assignments: [],
      requiredSkills: [],
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));

    return schedule;
  }

  async duplicateSchedule(id: number, newName: string, newStartDate: string, newEndDate: string, createdBy: number): Promise<number> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get original schedule
      const original = await this.getScheduleWithShifts(id);
      if (!original) {
        throw new Error('Schedule not found');
      }

      // Create new schedule
      const scheduleQuery = `
        INSERT INTO schedules (
          name, start_date, end_date, department_id, created_by, status
        ) VALUES (?, ?, ?, ?, ?, 'draft')
      `;
      
      const [result] = await connection.execute<ResultSetHeader>(scheduleQuery, [
        newName,
        newStartDate,
        newEndDate,
        original.departmentId,
        createdBy
      ]);

      const newScheduleId = result.insertId;

      // Calculate date offset
      const originalStart = new Date(original.startDate);
      const newStart = new Date(newStartDate);
      const dayOffset = Math.floor((newStart.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

      // Duplicate shifts
      if (original.shifts?.length) {
        for (const shift of original.shifts) {
          const shiftDate = new Date(shift.date);
          shiftDate.setDate(shiftDate.getDate() + dayOffset);
          
          const shiftQuery = `
            INSERT INTO shifts (
              schedule_id, template_id, shift_date, start_time, end_time, 
              required_staff, department_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
          `;
          
          const [shiftResult] = await connection.execute<ResultSetHeader>(shiftQuery, [
            newScheduleId,
            shift.templateId,
            shiftDate.toISOString().split('T')[0],
            shift.startTime,
            shift.endTime,
            shift.requiredStaff,
            shift.departmentId
          ]);

          // Copy required skills
          if (shift.requiredSkills?.length) {
            for (const skillId of shift.requiredSkills) {
              await connection.execute(
                'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
                [shiftResult.insertId, skillId]
              );
            }
          }
        }
      }

      await connection.commit();
      return newScheduleId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Generate optimized schedule assignments using constraint satisfaction algorithm
   */
  async generateOptimizedSchedule(scheduleId: number, userId: number) {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get schedule with shifts
      const schedule = await this.getScheduleWithShifts(scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Get all employees for this department
      const [employees] = await connection.execute<RowDataPacket[]>(
        `SELECT e.employee_id, e.first_name, e.last_name, e.skills, e.max_hours_per_week, e.min_hours_per_week
         FROM employees e
         WHERE e.department_id = ? AND e.status = 'active'`,
        [schedule.departmentId]
      );

      if (employees.length === 0) {
        throw new Error('No active employees found in department');
      }

      // Convert to optimizer format
      const { ScheduleOptimizer } = await import('../optimization/ScheduleOptimizer');
      const optimizer = new ScheduleOptimizer({
        startDate: new Date(schedule.startDate),
        endDate: new Date(schedule.endDate),
        maxIterations: 10000,
        temperature: 100,
        coolingRate: 0.95,
        timeoutMs: 300000
      });

      // Build shifts requirements
      const shiftsRequirements = (schedule.shifts || []).map((shift: any) => ({
        shiftId: shift.id,
        date: new Date(shift.date),
        requiredStaff: shift.requiredStaff,
        minSkillLevel: 1,
        allowedSkills: shift.requiredSkills || [],
        department: (schedule.departmentId || 0).toString(),
        priority: 'normal' as const
      }));

      // Build employee profiles
      const employeeProfiles = employees.map((emp: RowDataPacket) => ({
        id: emp.employee_id,
        maxHoursPerWeek: emp.max_hours_per_week || 40,
        minHoursPerWeek: emp.min_hours_per_week || 20,
        skills: (emp.skills || '').split(',').map((s: string) => s.trim()),
        availableDays: [true, true, true, true, true, true, true], // All days available by default
        preferences: {
          preferredShifts: [],
          avoidShifts: [],
          maxConsecutiveDays: 6,
          minDaysBetweenShifts: 1
        },
        restrictions: {
          unavailableDates: [],
          maxOvertimePerMonth: 20,
          certifications: []
        }
      }));

      // Run optimization
      const optimizedAssignments = optimizer.optimize(employeeProfiles, shiftsRequirements);

      // Get schedule stats
      const stats = optimizer.getScheduleStats(optimizedAssignments);

      // Store assignments in database
      let assignmentsStored = 0;
      for (const assignment of optimizedAssignments) {
        await connection.execute(
          `INSERT INTO assignments (
            schedule_id, employee_id, shift_id, status, assigned_by, assigned_at
          ) VALUES (?, ?, ?, 'assigned', ?, NOW())`,
          [scheduleId, assignment.employeeId, assignment.shiftId, userId]
        );
        assignmentsStored++;
      }

      // Update schedule status
      await connection.execute(
        'UPDATE schedules SET status = ?, updated_at = NOW() WHERE schedule_id = ?',
        ['generated', scheduleId]
      );

      await connection.commit();

      return {
        scheduleId,
        totalAssignments: assignmentsStored,
        coverage: stats.coverageRate.toFixed(2) + '%',
        fairnessScore: stats.fairnessScore.toFixed(2),
        message: `Successfully generated ${assignmentsStored} assignments with ${stats.coverageRate.toFixed(1)}% coverage`
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
