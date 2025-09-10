import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { Shift, CreateShiftRequest, UpdateShiftRequest, ShiftTemplate, CreateShiftTemplateRequest, UpdateShiftTemplateRequest } from '../types';

export class ShiftService {
  constructor(private pool: Pool) {}

  // Shift Template Management
  async getAllShiftTemplates(): Promise<ShiftTemplate[]> {
    const query = `
      SELECT 
        st.template_id as id,
        st.name,
        st.start_time as startTime,
        st.end_time as endTime,
        st.break_duration as breakDuration,
        st.required_staff as requiredStaff,
        st.department_id as departmentId,
        st.is_active as isActive,
        st.created_at as createdAt,
        st.updated_at as updatedAt,
        d.name as departmentName
      FROM shift_templates st
      LEFT JOIN departments d ON st.department_id = d.department_id
      WHERE st.is_active = 1
      ORDER BY st.name
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      breakDuration: row.breakDuration,
      requiredStaff: row.requiredStaff,
      departmentId: row.departmentId,
      requiredSkills: [], // Will be loaded separately if needed
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getShiftTemplateById(id: number): Promise<ShiftTemplate | null> {
    const query = `
      SELECT 
        st.template_id as id,
        st.name,
        st.start_time as startTime,
        st.end_time as endTime,
        st.break_duration as breakDuration,
        st.required_staff as requiredStaff,
        st.department_id as departmentId,
        st.is_active as isActive,
        st.created_at as createdAt,
        st.updated_at as updatedAt
      FROM shift_templates st
      WHERE st.template_id = ?
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    
    // Get required skills
    const skillsQuery = `
      SELECT skill_id FROM shift_template_skills WHERE template_id = ?
    `;
    const [skillRows] = await this.pool.execute<RowDataPacket[]>(skillsQuery, [id]);
    const requiredSkills = skillRows.map(skill => skill.skill_id);
    
    return {
      id: row.id,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      breakDuration: row.breakDuration,
      requiredStaff: row.requiredStaff,
      departmentId: row.departmentId,
      requiredSkills,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async createShiftTemplate(templateData: CreateShiftTemplateRequest): Promise<number> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const query = `
        INSERT INTO shift_templates (
          name, start_time, end_time, break_duration, required_staff, 
          department_id, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `;
      
      const [result] = await connection.execute<ResultSetHeader>(query, [
        templateData.name,
        templateData.startTime,
        templateData.endTime,
        templateData.breakDuration || 0,
        templateData.requiredStaff,
        templateData.departmentId
      ]);

      const templateId = result.insertId;

      // Add required skills if provided
      if (templateData.requiredSkills?.length) {
        for (const skillId of templateData.requiredSkills) {
          await connection.execute(
            'INSERT INTO shift_template_skills (template_id, skill_id) VALUES (?, ?)',
            [templateId, skillId]
          );
        }
      }

      await connection.commit();
      return templateId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateShiftTemplate(id: number, templateData: UpdateShiftTemplateRequest): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const updates: string[] = [];
      const values: any[] = [];
      
      if (templateData.name !== undefined) {
        updates.push('name = ?');
        values.push(templateData.name);
      }
      if (templateData.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(templateData.startTime);
      }
      if (templateData.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(templateData.endTime);
      }
      if (templateData.breakDuration !== undefined) {
        updates.push('break_duration = ?');
        values.push(templateData.breakDuration);
      }
      if (templateData.requiredStaff !== undefined) {
        updates.push('required_staff = ?');
        values.push(templateData.requiredStaff);
      }
      if (templateData.departmentId !== undefined) {
        updates.push('department_id = ?');
        values.push(templateData.departmentId);
      }
      if (templateData.isActive !== undefined) {
        updates.push('is_active = ?');
        values.push(templateData.isActive ? 1 : 0);
      }
      
      if (updates.length > 0) {
        values.push(id);
        const query = `UPDATE shift_templates SET ${updates.join(', ')} WHERE template_id = ?`;
        await connection.execute(query, values);
      }

      // Update required skills if provided
      if (templateData.requiredSkills !== undefined) {
        // Remove existing skills
        await connection.execute('DELETE FROM shift_template_skills WHERE template_id = ?', [id]);
        
        // Add new skills
        for (const skillId of templateData.requiredSkills) {
          await connection.execute(
            'INSERT INTO shift_template_skills (template_id, skill_id) VALUES (?, ?)',
            [id, skillId]
          );
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteShiftTemplate(id: number): Promise<boolean> {
    const query = 'UPDATE shift_templates SET is_active = 0 WHERE template_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, [id]);
    return result.affectedRows > 0;
  }

  // Shift Management
  async getAllShifts(): Promise<Shift[]> {
    const query = `
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
        COUNT(a.assignment_id) as assignedStaff,
        d.name as departmentName
      FROM shifts s
      LEFT JOIN assignments a ON s.shift_id = a.shift_id AND a.status IN ('scheduled', 'confirmed')
      LEFT JOIN departments d ON s.department_id = d.department_id
      GROUP BY s.shift_id
      ORDER BY s.shift_date, s.start_time
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id,
      scheduleId: row.scheduleId,
      templateId: row.templateId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      requiredStaff: row.requiredStaff,
      assignedStaff: row.assignedStaff,
      departmentId: row.departmentId,
      assignments: [], // Will be loaded separately if needed
      requiredSkills: [], // Will be loaded separately if needed
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  async getShiftById(id: number): Promise<Shift | null> {
    const query = `
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
      WHERE s.shift_id = ?
      GROUP BY s.shift_id
    `;
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    
    // Get required skills
    const skillsQuery = `
      SELECT skill_id FROM shift_skills WHERE shift_id = ?
    `;
    const [skillRows] = await this.pool.execute<RowDataPacket[]>(skillsQuery, [id]);
    const requiredSkills = skillRows.map(skill => skill.skill_id);
    
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      templateId: row.templateId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      requiredStaff: row.requiredStaff,
      assignedStaff: row.assignedStaff,
      departmentId: row.departmentId,
      assignments: [], // Will be loaded separately if needed
      requiredSkills,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  async createShift(shiftData: CreateShiftRequest): Promise<number> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const query = `
        INSERT INTO shifts (
          schedule_id, template_id, shift_date, start_time, end_time, 
          required_staff, department_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
      `;
      
      const [result] = await connection.execute<ResultSetHeader>(query, [
        shiftData.scheduleId,
        shiftData.templateId || null,
        shiftData.date,
        shiftData.startTime,
        shiftData.endTime,
        shiftData.requiredStaff,
        shiftData.departmentId
      ]);

      const shiftId = result.insertId;

      // Add required skills if provided
      if (shiftData.requiredSkills?.length) {
        for (const skillId of shiftData.requiredSkills) {
          await connection.execute(
            'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
            [shiftId, skillId]
          );
        }
      }

      await connection.commit();
      return shiftId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateShift(id: number, shiftData: UpdateShiftRequest): Promise<boolean> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const updates: string[] = [];
      const values: any[] = [];
      
      if (shiftData.date !== undefined) {
        updates.push('shift_date = ?');
        values.push(shiftData.date);
      }
      if (shiftData.startTime !== undefined) {
        updates.push('start_time = ?');
        values.push(shiftData.startTime);
      }
      if (shiftData.endTime !== undefined) {
        updates.push('end_time = ?');
        values.push(shiftData.endTime);
      }
      if (shiftData.requiredStaff !== undefined) {
        updates.push('required_staff = ?');
        values.push(shiftData.requiredStaff);
      }
      if (shiftData.departmentId !== undefined) {
        updates.push('department_id = ?');
        values.push(shiftData.departmentId);
      }
      
      if (updates.length > 0) {
        values.push(id);
        const query = `UPDATE shifts SET ${updates.join(', ')} WHERE shift_id = ?`;
        await connection.execute(query, values);
      }

      // Update required skills if provided
      if (shiftData.requiredSkills !== undefined) {
        // Remove existing skills
        await connection.execute('DELETE FROM shift_skills WHERE shift_id = ?', [id]);
        
        // Add new skills
        for (const skillId of shiftData.requiredSkills) {
          await connection.execute(
            'INSERT INTO shift_skills (shift_id, skill_id) VALUES (?, ?)',
            [id, skillId]
          );
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteShift(id: number): Promise<boolean> {
    // Check if shift has assignments
    const [assignmentRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM assignments WHERE shift_id = ?', 
      [id]
    );
    
    if (assignmentRows[0].count > 0) {
      throw new Error('Cannot delete shift with existing assignments');
    }

    const query = 'DELETE FROM shifts WHERE shift_id = ?';
    const [result] = await this.pool.execute<ResultSetHeader>(query, [id]);
    return result.affectedRows > 0;
  }

  async getShiftsBySchedule(scheduleId: number): Promise<Shift[]> {
    const query = `
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
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, [scheduleId]);
    return rows.map(row => ({
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
  }

  async getShiftsByDepartment(departmentId: number, startDate?: string, endDate?: string): Promise<Shift[]> {
    let query = `
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
      WHERE s.department_id = ?
    `;
    
    const params: any[] = [departmentId];
    
    if (startDate) {
      query += ' AND s.shift_date >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND s.shift_date <= ?';
      params.push(endDate);
    }
    
    query += ' GROUP BY s.shift_id ORDER BY s.shift_date, s.start_time';
    
    const [rows] = await this.pool.execute<RowDataPacket[]>(query, params);
    return rows.map(row => ({
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
  }
}
