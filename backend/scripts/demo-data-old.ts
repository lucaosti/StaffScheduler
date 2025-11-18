#!/usr/bin/env ts-node
/**
 * Demo Data Script for Staff Scheduler
 * 
 * Populates database with realistic sample data for testing and demonstration.
 * Inspired by PoliTO_Timetable_Allocator approach with correlations and constraints.
 * 
 * Features:
 * - 5 departments (IT, HR, Operations, Sales, Customer Support)
 * - 50 employees with realistic skills, availability, and preferences
 * - 200+ shifts covering a month period
 * - Employee-shift preferences (correlations) as optimization weights
 * - System settings for constraint configuration
 * 
 * Usage:
 *   npm run demo:install  - Install all demo data
 *   npm run demo:remove   - Remove all demo data
 *   npm run demo:report   - Show statistics
 */

import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'staff_scheduler'
};

// Demo data configuration
const DEPARTMENTS = [
  { name: 'Information Technology', code: 'IT', budget: 500000 },
  { name: 'Human Resources', code: 'HR', budget: 300000 },
  { name: 'Operations', code: 'OPS', budget: 400000 },
  { name: 'Sales', code: 'SALES', budget: 600000 },
  { name: 'Customer Support', code: 'CS', budget: 350000 }
];

const SKILLS = [
  // IT Skills
  { name: 'Software Development', category: 'IT' },
  { name: 'Database Administration', category: 'IT' },
  { name: 'Network Management', category: 'IT' },
  { name: 'Cybersecurity', category: 'IT' },
  { name: 'DevOps', category: 'IT' },
  
  // HR Skills
  { name: 'Recruitment', category: 'HR' },
  { name: 'Employee Relations', category: 'HR' },
  { name: 'Payroll Management', category: 'HR' },
  { name: 'Training & Development', category: 'HR' },
  
  // Operations Skills
  { name: 'Project Management', category: 'Operations' },
  { name: 'Process Optimization', category: 'Operations' },
  { name: 'Quality Assurance', category: 'Operations' },
  { name: 'Supply Chain', category: 'Operations' },
  
  // Sales Skills
  { name: 'B2B Sales', category: 'Sales' },
  { name: 'B2C Sales', category: 'Sales' },
  { name: 'Account Management', category: 'Sales' },
  { name: 'Business Development', category: 'Sales' },
  
  // Customer Support Skills
  { name: 'Technical Support', category: 'Customer Support' },
  { name: 'Customer Service', category: 'Customer Support' },
  { name: 'Complaint Resolution', category: 'Customer Support' },
  { name: 'CRM Systems', category: 'Customer Support' }
];

// Employee templates (will generate realistic variations)
const EMPLOYEE_TEMPLATES = [
  // IT Department
  { firstName: 'John', lastName: 'Smith', email: 'john.smith@company.com', department: 'IT', position: 'Senior Developer', skills: ['Software Development', 'DevOps'], hourlyRate: 65, maxHours: 40 },
  { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.johnson@company.com', department: 'IT', position: 'Database Admin', skills: ['Database Administration', 'DevOps'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Michael', lastName: 'Williams', email: 'michael.williams@company.com', department: 'IT', position: 'Network Engineer', skills: ['Network Management', 'Cybersecurity'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Emily', lastName: 'Brown', email: 'emily.brown@company.com', department: 'IT', position: 'Security Specialist', skills: ['Cybersecurity', 'Network Management'], hourlyRate: 62, maxHours: 40 },
  { firstName: 'David', lastName: 'Jones', email: 'david.jones@company.com', department: 'IT', position: 'Junior Developer', skills: ['Software Development'], hourlyRate: 45, maxHours: 40 },
  { firstName: 'Jessica', lastName: 'Garcia', email: 'jessica.garcia@company.com', department: 'IT', position: 'DevOps Engineer', skills: ['DevOps', 'Software Development'], hourlyRate: 63, maxHours: 40 },
  { firstName: 'Daniel', lastName: 'Martinez', email: 'daniel.martinez@company.com', department: 'IT', position: 'Full Stack Developer', skills: ['Software Development', 'Database Administration'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Ashley', lastName: 'Rodriguez', email: 'ashley.rodriguez@company.com', department: 'IT', position: 'System Admin', skills: ['Network Management', 'Database Administration'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'James', lastName: 'Hernandez', email: 'james.hernandez@company.com', department: 'IT', position: 'Security Analyst', skills: ['Cybersecurity'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Amanda', lastName: 'Lopez', email: 'amanda.lopez@company.com', department: 'IT', position: 'Backend Developer', skills: ['Software Development', 'Database Administration'], hourlyRate: 62, maxHours: 40 },
  
  // HR Department
  { firstName: 'Robert', lastName: 'Wilson', email: 'robert.wilson@company.com', department: 'HR', position: 'HR Manager', skills: ['Recruitment', 'Employee Relations'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'Jennifer', lastName: 'Anderson', email: 'jennifer.anderson@company.com', department: 'HR', position: 'Recruiter', skills: ['Recruitment'], hourlyRate: 45, maxHours: 40 },
  { firstName: 'William', lastName: 'Taylor', email: 'william.taylor@company.com', department: 'HR', position: 'Payroll Specialist', skills: ['Payroll Management'], hourlyRate: 48, maxHours: 40 },
  { firstName: 'Linda', lastName: 'Thomas', email: 'linda.thomas@company.com', department: 'HR', position: 'Training Coordinator', skills: ['Training & Development'], hourlyRate: 50, maxHours: 40 },
  { firstName: 'Richard', lastName: 'Moore', email: 'richard.moore@company.com', department: 'HR', position: 'HR Generalist', skills: ['Employee Relations', 'Recruitment'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Patricia', lastName: 'Jackson', email: 'patricia.jackson@company.com', department: 'HR', position: 'Benefits Admin', skills: ['Payroll Management', 'Employee Relations'], hourlyRate: 47, maxHours: 40 },
  { firstName: 'Christopher', lastName: 'White', email: 'christopher.white@company.com', department: 'HR', position: 'Talent Acquisition', skills: ['Recruitment'], hourlyRate: 53, maxHours: 40 },
  { firstName: 'Barbara', lastName: 'Harris', email: 'barbara.harris@company.com', department: 'HR', position: 'Learning Specialist', skills: ['Training & Development'], hourlyRate: 49, maxHours: 40 },
  { firstName: 'Thomas', lastName: 'Martin', email: 'thomas.martin@company.com', department: 'HR', position: 'HR Coordinator', skills: ['Employee Relations'], hourlyRate: 44, maxHours: 40 },
  { firstName: 'Nancy', lastName: 'Thompson', email: 'nancy.thompson@company.com', department: 'HR', position: 'Compensation Analyst', skills: ['Payroll Management'], hourlyRate: 51, maxHours: 40 },
  
  // Operations Department
  { firstName: 'Charles', lastName: 'Garcia', email: 'charles.garcia@company.com', department: 'Operations', position: 'Operations Manager', skills: ['Project Management', 'Process Optimization'], hourlyRate: 65, maxHours: 40 },
  { firstName: 'Susan', lastName: 'Martinez', email: 'susan.martinez@company.com', department: 'Operations', position: 'Project Manager', skills: ['Project Management'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Joseph', lastName: 'Robinson', email: 'joseph.robinson@company.com', department: 'Operations', position: 'Process Analyst', skills: ['Process Optimization', 'Quality Assurance'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'Karen', lastName: 'Clark', email: 'karen.clark@company.com', department: 'Operations', position: 'QA Manager', skills: ['Quality Assurance'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Paul', lastName: 'Lewis', email: 'paul.lewis@company.com', department: 'Operations', position: 'Supply Chain Coordinator', skills: ['Supply Chain'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Lisa', lastName: 'Lee', email: 'lisa.lee@company.com', department: 'Operations', position: 'Operations Analyst', skills: ['Process Optimization', 'Project Management'], hourlyRate: 54, maxHours: 40 },
  { firstName: 'Mark', lastName: 'Walker', email: 'mark.walker@company.com', department: 'Operations', position: 'QA Specialist', skills: ['Quality Assurance'], hourlyRate: 50, maxHours: 40 },
  { firstName: 'Betty', lastName: 'Hall', email: 'betty.hall@company.com', department: 'Operations', position: 'Logistics Manager', skills: ['Supply Chain', 'Project Management'], hourlyRate: 57, maxHours: 40 },
  { firstName: 'George', lastName: 'Allen', email: 'george.allen@company.com', department: 'Operations', position: 'Process Coordinator', skills: ['Process Optimization'], hourlyRate: 51, maxHours: 40 },
  { firstName: 'Helen', lastName: 'Young', email: 'helen.young@company.com', department: 'Operations', position: 'Operations Coordinator', skills: ['Project Management'], hourlyRate: 48, maxHours: 40 },
  
  // Sales Department
  { firstName: 'Steven', lastName: 'King', email: 'steven.king@company.com', department: 'Sales', position: 'Sales Director', skills: ['B2B Sales', 'Account Management'], hourlyRate: 70, maxHours: 40 },
  { firstName: 'Donna', lastName: 'Wright', email: 'donna.wright@company.com', department: 'Sales', position: 'Account Executive', skills: ['B2B Sales'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Edward', lastName: 'Lopez', email: 'edward.lopez@company.com', department: 'Sales', position: 'Sales Manager', skills: ['B2C Sales', 'Account Management'], hourlyRate: 62, maxHours: 40 },
  { firstName: 'Carol', lastName: 'Hill', email: 'carol.hill@company.com', department: 'Sales', position: 'Business Developer', skills: ['Business Development', 'B2B Sales'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Brian', lastName: 'Scott', email: 'brian.scott@company.com', department: 'Sales', position: 'Sales Representative', skills: ['B2C Sales'], hourlyRate: 48, maxHours: 40 },
  { firstName: 'Dorothy', lastName: 'Green', email: 'dorothy.green@company.com', department: 'Sales', position: 'Account Manager', skills: ['Account Management', 'B2B Sales'], hourlyRate: 56, maxHours: 40 },
  { firstName: 'Ronald', lastName: 'Adams', email: 'ronald.adams@company.com', department: 'Sales', position: 'Senior Sales Rep', skills: ['B2C Sales', 'Business Development'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Michelle', lastName: 'Baker', email: 'michelle.baker@company.com', department: 'Sales', position: 'Inside Sales', skills: ['B2C Sales'], hourlyRate: 45, maxHours: 40 },
  { firstName: 'Kevin', lastName: 'Gonzalez', email: 'kevin.gonzalez@company.com', department: 'Sales', position: 'Territory Manager', skills: ['B2B Sales', 'Account Management'], hourlyRate: 59, maxHours: 40 },
  { firstName: 'Sandra', lastName: 'Nelson', email: 'sandra.nelson@company.com', department: 'Sales', position: 'Sales Coordinator', skills: ['Account Management'], hourlyRate: 47, maxHours: 40 },
  
  // Customer Support Department
  { firstName: 'Kenneth', lastName: 'Carter', email: 'kenneth.carter@company.com', department: 'Customer Support', position: 'Support Manager', skills: ['Technical Support', 'Customer Service'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'Kimberly', lastName: 'Mitchell', email: 'kimberly.mitchell@company.com', department: 'Customer Support', position: 'Technical Support', skills: ['Technical Support'], hourlyRate: 48, maxHours: 40 },
  { firstName: 'Jason', lastName: 'Perez', email: 'jason.perez@company.com', department: 'Customer Support', position: 'Customer Service Rep', skills: ['Customer Service', 'CRM Systems'], hourlyRate: 42, maxHours: 40 },
  { firstName: 'Laura', lastName: 'Roberts', email: 'laura.roberts@company.com', department: 'Customer Support', position: 'Support Specialist', skills: ['Technical Support', 'Complaint Resolution'], hourlyRate: 46, maxHours: 40 },
  { firstName: 'Joshua', lastName: 'Turner', email: 'joshua.turner@company.com', department: 'Customer Support', position: 'Senior Support', skills: ['Technical Support', 'CRM Systems'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Angela', lastName: 'Phillips', email: 'angela.phillips@company.com', department: 'Customer Support', position: 'Service Coordinator', skills: ['Customer Service', 'Complaint Resolution'], hourlyRate: 44, maxHours: 40 },
  { firstName: 'Ryan', lastName: 'Campbell', email: 'ryan.campbell@company.com', department: 'Customer Support', position: 'Help Desk', skills: ['Technical Support'], hourlyRate: 40, maxHours: 40 },
  { firstName: 'Melissa', lastName: 'Parker', email: 'melissa.parker@company.com', department: 'Customer Support', position: 'CRM Specialist', skills: ['CRM Systems', 'Customer Service'], hourlyRate: 47, maxHours: 40 },
  { firstName: 'Eric', lastName: 'Evans', email: 'eric.evans@company.com', department: 'Customer Support', position: 'Support Analyst', skills: ['Technical Support', 'Customer Service'], hourlyRate: 49, maxHours: 40 },
  { firstName: 'Rebecca', lastName: 'Edwards', email: 'rebecca.edwards@company.com', department: 'Customer Support', position: 'Customer Success', skills: ['Customer Service', 'CRM Systems'], hourlyRate: 50, maxHours: 40 }
];

async function installDemoData(conn: mysql.Connection) {
  console.log('\n🚀 Installing demo data...\n');
  
  try {
    // Clear existing data in reverse order of foreign key dependencies
    console.log('📝 Clearing existing data...');
    await conn.query('DELETE FROM shift_assignments');
    await conn.query('DELETE FROM employee_skills');
    await conn.query('DELETE FROM employee_preferences');
    await conn.query('DELETE FROM employee_availability');
    await conn.query('DELETE FROM shifts');
    await conn.query('DELETE FROM schedules');
    await conn.query('DELETE FROM skills');
    await conn.query('DELETE FROM employees');
    await conn.query('DELETE FROM department_managers');
    await conn.query('DELETE FROM departments');
    await conn.query('DELETE FROM users WHERE email != "admin@staffscheduler.com"');
    
    // 1. Create Departments
    console.log('🏢 Creating departments...');
    const departmentIds: Record<string, number> = {};
    
    for (const dept of DEPARTMENTS) {
      const [result] = await conn.query(
        'INSERT INTO departments (name, code, budget, is_active) VALUES (?, ?, ?, TRUE)',
        [dept.name, dept.code, dept.budget]
      );
      departmentIds[dept.code] = (result as any).insertId;
      console.log(`  ✓ ${dept.name} (ID: ${departmentIds[dept.code]})`);
    }
    
    // 2. Create Skills
    console.log('\n🎯 Creating skills...');
    const skillIds: Record<string, number> = {};
    
    for (const skill of SKILLS) {
      const [result] = await conn.query(
        'INSERT INTO skills (name, description, category) VALUES (?, ?, ?)',
        [skill.name, `${skill.name} skill for ${skill.category} department`, skill.category]
      );
      skillIds[skill.name] = (result as any).insertId;
    }
    console.log(`  ✓ Created ${SKILLS.length} skills`);
    
    // 3. Create Employees
    console.log('\n👥 Creating employees...');
    const employeeIds: number[] = [];
    
    for (const emp of EMPLOYEE_TEMPLATES) {
      const deptId = departmentIds[emp.department];
      const employeeId = `EMP${String(employeeIds.length + 1).padStart(3, '0')}`;
      
      const [result] = await conn.query(
        `INSERT INTO employees (
          employee_id, first_name, last_name, email, phone,
          department_id, position, hire_date, employment_type,
          hourly_rate, max_hours_per_week, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          employeeId,
          emp.firstName,
          emp.lastName,
          emp.email,
          `+1-555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
          deptId,
          emp.position,
          new Date('2024-01-01'),
          'full-time',
          emp.hourlyRate,
          emp.maxHours
        ]
      );
      
      const empDbId = (result as any).insertId;
      employeeIds.push(empDbId);
      
      // Add skills for employee
      for (const skillName of emp.skills) {
        await conn.query(
          'INSERT INTO employee_skills (employee_id, skill_id, proficiency_level) VALUES (?, ?, ?)',
          [empDbId, skillIds[skillName], Math.floor(Math.random() * 3) + 3] // Level 3-5
        );
      }
      
      // Add availability (random unavailable days)
      const unavailableDays = Math.random() < 0.3 ? Math.floor(Math.random() * 2) : 0;
      for (let i = 0; i < unavailableDays; i++) {
        const randomDay = Math.floor(Math.random() * 30) + 1;
        const date = new Date(2025, 10, randomDay); // November 2025
        await conn.query(
          'INSERT INTO employee_availability (employee_id, date, is_available, reason) VALUES (?, ?, FALSE, ?)',
          [empDbId, date, 'Personal day']
        );
      }
      
      console.log(`  ✓ ${emp.firstName} ${emp.lastName} - ${emp.position} (${emp.department})`);
    }
    
    console.log(`\n  📊 Total employees created: ${employeeIds.length}`);
    
    // 4. Create Schedule
    console.log('\n📅 Creating schedule...');
    const [scheduleResult] = await conn.query(
      `INSERT INTO schedules (
        name, start_date, end_date, status, created_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'November 2025 Schedule',
        new Date('2025-11-01'),
        new Date('2025-11-30'),
        'draft',
        1, // admin user
        'Demo schedule for November 2025'
      ]
    );
    
    const scheduleId = (scheduleResult as any).insertId;
    console.log(`  ✓ Schedule created (ID: ${scheduleId})`);
    
    // 5. Create Shifts (inspired by PoliTO's teaching slots)
    console.log('\n⏰ Creating shifts...');
    const shiftTypes = [
      { name: 'Morning Shift', start: '08:00', end: '16:00', department: 'IT' },
      { name: 'Day Shift', start: '09:00', end: '17:00', department: 'HR' },
      { name: 'Afternoon Shift', start: '13:00', end: '21:00', department: 'Operations' },
      { name: 'Evening Shift', start: '16:00', end: '00:00', department: 'Sales' },
      { name: 'Support Shift', start: '10:00', end: '18:00', department: 'Customer Support' }
    ];
    
    let shiftCount = 0;
    for (let day = 1; day <= 30; day++) {
      const date = new Date(2025, 10, day); // November 2025
      const dayOfWeek = date.getDay();
      
      // Skip Sundays
      if (dayOfWeek === 0) continue;
      
      for (const shiftType of shiftTypes) {
        const deptId = departmentIds[shiftType.department];
        const requiredStaff = Math.floor(Math.random() * 3) + 2; // 2-4 people per shift
        
        const [result] = await conn.query(
          `INSERT INTO shifts (
            schedule_id, department_id, shift_date, start_time, end_time,
            required_staff, shift_type, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            scheduleId,
            deptId,
            date,
            shiftType.start,
            shiftType.end,
            requiredStaff,
            shiftType.name,
            `${shiftType.name} for ${shiftType.department}`
          ]
        );
        
        shiftCount++;
      }
    }
    
    console.log(`  ✓ Created ${shiftCount} shifts across 30 days`);
    
    // 6. Create Employee Preferences (correlations as weights)
    console.log('\n💡 Creating employee preferences (correlation weights)...');
    let prefCount = 0;
    
    for (const empId of employeeIds) {
      // Each employee has preferences for certain shift types
      const numPreferences = Math.floor(Math.random() * 3) + 1; // 1-3 preferences
      
      for (let i = 0; i < numPreferences; i++) {
        const randomShiftType = shiftTypes[Math.floor(Math.random() * shiftTypes.length)];
        const preferenceWeight = Math.floor(Math.random() * 50) + 50; // Weight 50-100
        const preferenceType = Math.random() < 0.7 ? 'preferred' : 'avoid';
        
        await conn.query(
          `INSERT INTO employee_preferences (
            employee_id, preference_type, shift_type, weight, notes
          ) VALUES (?, ?, ?, ?, ?)`,
          [
            empId,
            preferenceType,
            randomShiftType.name,
            preferenceType === 'preferred' ? preferenceWeight : -preferenceWeight,
            `${preferenceType === 'preferred' ? 'Prefers' : 'Avoids'} ${randomShiftType.name}`
          ]
        );
        
        prefCount++;
      }
    }
    
    console.log(`  ✓ Created ${prefCount} employee preferences with correlation weights`);
    
    // 7. Update System Settings
    console.log('\n⚙️  Updating system settings...');
    await conn.query(`
      INSERT INTO system_settings (setting_key, setting_value, description, data_type, category)
      VALUES 
        ('max_consecutive_work_days', '5', 'Maximum consecutive work days allowed', 'number', 'constraints'),
        ('min_rest_hours_between_shifts', '11', 'Minimum rest hours between shifts (EU directive)', 'number', 'constraints'),
        ('max_hours_per_week', '48', 'Maximum hours per week per employee', 'number', 'constraints'),
        ('max_hours_per_day', '12', 'Maximum hours per day', 'number', 'constraints'),
        ('enable_shift_preferences', 'true', 'Consider employee preferences in optimization', 'boolean', 'optimization'),
        ('preference_weight', '55', 'Weight for employee preferences in objective function', 'number', 'optimization'),
        ('fairness_weight', '40', 'Weight for workload fairness', 'number', 'optimization'),
        ('dispersion_weight', '25', 'Weight for shift dispersion penalty', 'number', 'optimization')
      ON DUPLICATE KEY UPDATE 
        setting_value = VALUES(setting_value),
        description = VALUES(description)
    `);
    
    console.log('  ✓ System settings configured');
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Demo Data Installation Complete!');
    console.log('='.repeat(60));
    console.log(`📊 Summary:`);
    console.log(`   • Departments: ${DEPARTMENTS.length}`);
    console.log(`   • Skills: ${SKILLS.length}`);
    console.log(`   • Employees: ${employeeIds.length}`);
    console.log(`   • Shifts: ${shiftCount}`);
    console.log(`   • Preferences: ${prefCount}`);
    console.log(`   • Schedule Period: November 2025`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error installing demo data:', error);
    throw error;
  }
}

async function removeDemoData(conn: mysql.Connection) {
  console.log('\n🗑️  Removing demo data...\n');
  
  try {
    await conn.query('DELETE FROM shift_assignments');
    await conn.query('DELETE FROM employee_skills');
    await conn.query('DELETE FROM employee_preferences');
    await conn.query('DELETE FROM employee_availability');
    await conn.query('DELETE FROM shifts');
    await conn.query('DELETE FROM schedules');
    await conn.query('DELETE FROM skills');
    await conn.query('DELETE FROM employees');
    await conn.query('DELETE FROM department_managers');
    await conn.query('DELETE FROM departments');
    await conn.query('DELETE FROM users WHERE email != "admin@staffscheduler.com"');
    
    console.log('✅ All demo data removed successfully!\n');
  } catch (error) {
    console.error('❌ Error removing demo data:', error);
    throw error;
  }
}

async function showReport(conn: mysql.Connection) {
  console.log('\n📊 Demo Data Report\n');
  console.log('='.repeat(60));
  
  try {
    const [depts] = await conn.query('SELECT COUNT(*) as count FROM departments');
    const [skills] = await conn.query('SELECT COUNT(*) as count FROM skills');
    const [emps] = await conn.query('SELECT COUNT(*) as count FROM employees');
    const [shifts] = await conn.query('SELECT COUNT(*) as count FROM shifts');
    const [prefs] = await conn.query('SELECT COUNT(*) as count FROM employee_preferences');
    const [schedules] = await conn.query('SELECT COUNT(*) as count FROM schedules');
    
    console.log(`Departments:          ${(depts as any)[0].count}`);
    console.log(`Skills:               ${(skills as any)[0].count}`);
    console.log(`Employees:            ${(emps as any)[0].count}`);
    console.log(`Shifts:               ${(shifts as any)[0].count}`);
    console.log(`Employee Preferences: ${(prefs as any)[0].count}`);
    console.log(`Schedules:            ${(schedules as any)[0].count}`);
    
    console.log('\n📈 Statistics by Department:');
    const [deptStats] = await conn.query(`
      SELECT d.name, d.code, COUNT(e.id) as employee_count, COUNT(DISTINCT s.id) as shift_count
      FROM departments d
      LEFT JOIN employees e ON d.id = e.department_id
      LEFT JOIN shifts s ON d.id = s.department_id
      GROUP BY d.id, d.name, d.code
      ORDER BY d.code
    `);
    
    (deptStats as any[]).forEach((stat: any) => {
      console.log(`  ${stat.code.padEnd(6)} - ${stat.name.padEnd(30)} | Employees: ${String(stat.employee_count).padStart(3)} | Shifts: ${String(stat.shift_count).padStart(4)}`);
    });
    
    console.log('\n💡 Preference Distribution:');
    const [prefStats] = await conn.query(`
      SELECT preference_type, COUNT(*) as count, AVG(weight) as avg_weight
      FROM employee_preferences
      GROUP BY preference_type
    `);
    
    (prefStats as any[]).forEach((stat: any) => {
      console.log(`  ${stat.preference_type.padEnd(12)}: ${String(stat.count).padStart(4)} preferences | Avg Weight: ${Math.round(stat.avg_weight)}`);
    });
    
    console.log('='.repeat(60));
    console.log('');
    
  } catch (error) {
    console.error('❌ Error generating report:', error);
    throw error;
  }
}

async function main() {
  const conn = await mysql.createConnection(config);
  console.log('🔌 Connected to database: ' + config.database);
  
  const cmd = process.argv[2];
  
  try {
    if (cmd === 'install') {
      await installDemoData(conn);
    } else if (cmd === 'remove') {
      await removeDemoData(conn);
    } else if (cmd === 'report') {
      await showReport(conn);
    } else {
      console.log('\n📖 Usage:');
      console.log('  npm run demo:install  - Install comprehensive demo data');
      console.log('  npm run demo:remove   - Remove all demo data');
      console.log('  npm run demo:report   - Show statistics\n');
    }
  } finally {
    await conn.end();
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
