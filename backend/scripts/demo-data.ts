#!/usr/bin/env ts-node
/**
 * Demo Data Script for Staff Scheduler
 * 
 * Populates database with realistic sample data for testing and demonstration.
 * Inspired by PoliTO_Timetable_Allocator approach with correlations and constraints.
 * 
 * Features:
 * - 5 departments (IT, HR, Operations, Sales, Customer Support)
 * - 50 users/employees with realistic skills, availability, and preferences
 * - 150+ shifts covering November 2025
 * - User-shift preferences (correlations) as optimization weights
 * - System settings for constraint configuration
 * - Audit logs for activity tracking
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
  { name: 'Information Technology', code: 'IT', description: 'IT Department - Budget: $500,000' },
  { name: 'Human Resources', code: 'HR', description: 'HR Department - Budget: $300,000' },
  { name: 'Operations', code: 'OPS', description: 'Operations Department - Budget: $400,000' },
  { name: 'Sales', code: 'SALES', description: 'Sales Department - Budget: $600,000' },
  { name: 'Customer Support', code: 'CS', description: 'Customer Support Department - Budget: $350,000' }
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

// User/Employee templates (will generate realistic data)
const USER_TEMPLATES = [
  // IT Department (10 users)
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
  
  // HR Department (10 users)
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
  
  // Operations Department (10 users)
  { firstName: 'Charles', lastName: 'Garcia', email: 'charles.garcia@company.com', department: 'OPS', position: 'Operations Manager', skills: ['Project Management', 'Process Optimization'], hourlyRate: 65, maxHours: 40 },
  { firstName: 'Susan', lastName: 'Martinez', email: 'susan.martinez@company.com', department: 'OPS', position: 'Project Manager', skills: ['Project Management'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Joseph', lastName: 'Robinson', email: 'joseph.robinson@company.com', department: 'OPS', position: 'Process Analyst', skills: ['Process Optimization', 'Quality Assurance'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'Karen', lastName: 'Clark', email: 'karen.clark@company.com', department: 'OPS', position: 'QA Manager', skills: ['Quality Assurance'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Paul', lastName: 'Lewis', email: 'paul.lewis@company.com', department: 'OPS', position: 'Supply Chain Coordinator', skills: ['Supply Chain'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Lisa', lastName: 'Lee', email: 'lisa.lee@company.com', department: 'OPS', position: 'Operations Analyst', skills: ['Process Optimization', 'Project Management'], hourlyRate: 54, maxHours: 40 },
  { firstName: 'Mark', lastName: 'Walker', email: 'mark.walker@company.com', department: 'OPS', position: 'QA Specialist', skills: ['Quality Assurance'], hourlyRate: 50, maxHours: 40 },
  { firstName: 'Betty', lastName: 'Hall', email: 'betty.hall@company.com', department: 'OPS', position: 'Logistics Manager', skills: ['Supply Chain', 'Project Management'], hourlyRate: 57, maxHours: 40 },
  { firstName: 'George', lastName: 'Allen', email: 'george.allen@company.com', department: 'OPS', position: 'Process Coordinator', skills: ['Process Optimization'], hourlyRate: 51, maxHours: 40 },
  { firstName: 'Helen', lastName: 'Young', email: 'helen.young@company.com', department: 'OPS', position: 'Operations Coordinator', skills: ['Project Management'], hourlyRate: 48, maxHours: 40 },
  
  // Sales Department (10 users)
  { firstName: 'Steven', lastName: 'King', email: 'steven.king@company.com', department: 'SALES', position: 'Sales Director', skills: ['B2B Sales', 'Account Management'], hourlyRate: 70, maxHours: 40 },
  { firstName: 'Donna', lastName: 'Wright', email: 'donna.wright@company.com', department: 'SALES', position: 'Account Executive', skills: ['B2B Sales'], hourlyRate: 60, maxHours: 40 },
  { firstName: 'Edward', lastName: 'Lopez', email: 'edward.lopez@company.com', department: 'SALES', position: 'Sales Manager', skills: ['B2C Sales', 'Account Management'], hourlyRate: 62, maxHours: 40 },
  { firstName: 'Carol', lastName: 'Hill', email: 'carol.hill@company.com', department: 'SALES', position: 'Business Developer', skills: ['Business Development', 'B2B Sales'], hourlyRate: 58, maxHours: 40 },
  { firstName: 'Brian', lastName: 'Scott', email: 'brian.scott@company.com', department: 'SALES', position: 'Sales Representative', skills: ['B2C Sales'], hourlyRate: 48, maxHours: 40 },
  { firstName: 'Dorothy', lastName: 'Green', email: 'dorothy.green@company.com', department: 'SALES', position: 'Account Manager', skills: ['Account Management', 'B2B Sales'], hourlyRate: 56, maxHours: 40 },
  { firstName: 'Ronald', lastName: 'Adams', email: 'ronald.adams@company.com', department: 'SALES', position: 'Senior Sales Rep', skills: ['B2C Sales', 'Business Development'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Michelle', lastName: 'Baker', email: 'michelle.baker@company.com', department: 'SALES', position: 'Inside Sales', skills: ['B2C Sales'], hourlyRate: 45, maxHours: 40 },
  { firstName: 'Kevin', lastName: 'Gonzalez', email: 'kevin.gonzalez@company.com', department: 'SALES', position: 'Territory Manager', skills: ['B2B Sales', 'Account Management'], hourlyRate: 59, maxHours: 40 },
  { firstName: 'Sandra', lastName: 'Nelson', email: 'sandra.nelson@company.com', department: 'SALES', position: 'Sales Coordinator', skills: ['Account Management'], hourlyRate: 47, maxHours: 40 },
  
  // Customer Support Department (10 users)
  { firstName: 'Kenneth', lastName: 'Carter', email: 'kenneth.carter@company.com', department: 'CS', position: 'Support Manager', skills: ['Technical Support', 'Customer Service'], hourlyRate: 55, maxHours: 40 },
  { firstName: 'Kimberly', lastName: 'Mitchell', email: 'kimberly.mitchell@company.com', department: 'CS', position: 'Technical Support', skills: ['Technical Support'], hourlyRate: 48, maxHours: 40 },
  { firstName: 'Jason', lastName: 'Perez', email: 'jason.perez@company.com', department: 'CS', position: 'Customer Service Rep', skills: ['Customer Service', 'CRM Systems'], hourlyRate: 42, maxHours: 40 },
  { firstName: 'Laura', lastName: 'Roberts', email: 'laura.roberts@company.com', department: 'CS', position: 'Support Specialist', skills: ['Technical Support', 'Complaint Resolution'], hourlyRate: 46, maxHours: 40 },
  { firstName: 'Joshua', lastName: 'Turner', email: 'joshua.turner@company.com', department: 'CS', position: 'Senior Support', skills: ['Technical Support', 'CRM Systems'], hourlyRate: 52, maxHours: 40 },
  { firstName: 'Angela', lastName: 'Phillips', email: 'angela.phillips@company.com', department: 'CS', position: 'Service Coordinator', skills: ['Customer Service', 'Complaint Resolution'], hourlyRate: 44, maxHours: 40 },
  { firstName: 'Ryan', lastName: 'Campbell', email: 'ryan.campbell@company.com', department: 'CS', position: 'Help Desk', skills: ['Technical Support'], hourlyRate: 40, maxHours: 40 },
  { firstName: 'Melissa', lastName: 'Parker', email: 'melissa.parker@company.com', department: 'CS', position: 'CRM Specialist', skills: ['CRM Systems', 'Customer Service'], hourlyRate: 47, maxHours: 40 },
  { firstName: 'Eric', lastName: 'Evans', email: 'eric.evans@company.com', department: 'CS', position: 'Support Analyst', skills: ['Technical Support', 'Customer Service'], hourlyRate: 49, maxHours: 40 },
  { firstName: 'Rebecca', lastName: 'Edwards', email: 'rebecca.edwards@company.com', department: 'CS', position: 'Customer Success', skills: ['Customer Service', 'CRM Systems'], hourlyRate: 50, maxHours: 40 }
];

async function installDemoData(conn: mysql.Connection) {
  console.log('\n🚀 Installing demo data...\n');
  
  try {
    // Clear existing data in reverse order of foreign key dependencies
    console.log('📝 Clearing existing demo data...');
    await conn.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE role = "employee")');
    await conn.query('DELETE FROM shift_assignments');
    await conn.query('DELETE FROM user_unavailability');
    await conn.query('DELETE FROM user_preferences');
    await conn.query('DELETE FROM user_skills');
    await conn.query('DELETE FROM shift_skills');
    await conn.query('DELETE FROM shifts');
    await conn.query('DELETE FROM schedules WHERE name LIKE "%Demo%"');
    await conn.query('DELETE FROM shift_template_skills');
    await conn.query('DELETE FROM shift_templates WHERE name LIKE "%Demo%"');
    await conn.query('DELETE FROM user_departments WHERE user_id IN (SELECT id FROM users WHERE role = "employee")');
    await conn.query('DELETE FROM users WHERE role = "employee" AND email LIKE "%@company.com"');
    await conn.query('DELETE FROM skills WHERE name NOT IN (SELECT s.name FROM skills s JOIN user_skills us ON s.id = us.skill_id)');
    await conn.query('DELETE FROM departments WHERE name IN (?, ?, ?, ?, ?)', 
      [DEPARTMENTS[0].name, DEPARTMENTS[1].name, DEPARTMENTS[2].name, DEPARTMENTS[3].name, DEPARTMENTS[4].name]);
    
    // 1. Create Departments
    console.log('\n🏢 Creating departments...');
    const departmentIds: Record<string, number> = {};
    
    for (const dept of DEPARTMENTS) {
      const [result] = await conn.query(
        'INSERT INTO departments (name, description, is_active) VALUES (?, ?, TRUE)',
        [dept.name, dept.description]
      );
      departmentIds[dept.code] = (result as any).insertId;
      console.log(`   ✓ ${dept.name} (ID: ${departmentIds[dept.code]})`);
    }
    
    // 2. Create Skills
    console.log('\n🎯 Creating skills...');
    const skillIds: Record<string, number> = {};
    
    for (const skill of SKILLS) {
      const [result] = await conn.query(
        'INSERT INTO skills (name, description, is_active) VALUES (?, ?, TRUE)',
        [skill.name, `${skill.category} - ${skill.name}`]
      );
      skillIds[skill.name] = (result as any).insertId;
    }
    console.log(`   ✓ Created ${SKILLS.length} skills`);
    
    // 3. Create Admin User if doesn't exist
    console.log('\n👤 Checking admin user...');
    const [adminRows] = await conn.query('SELECT id FROM users WHERE email = "admin@staffscheduler.com"');
    let adminId: number;
    
    if ((adminRows as any[]).length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const [adminResult] = await conn.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
         VALUES ('admin@staffscheduler.com', ?, 'System', 'Administrator', 'admin', TRUE)`,
        [hashedPassword]
      );
      adminId = (adminResult as any).insertId;
      console.log(`   ✓ Created admin user (ID: ${adminId})`);
    } else {
      adminId = (adminRows as any[])[0].id;
      console.log(`   ✓ Admin user exists (ID: ${adminId})`);
    }
    
    // 4. Create Users (Employees)
    console.log('\n👥 Creating users/employees...');
    const userIds: number[] = [];
    const hashedPassword = await bcrypt.hash('demo123', 10);
    
    for (let i = 0; i < USER_TEMPLATES.length; i++) {
      const emp = USER_TEMPLATES[i];
      const deptId = departmentIds[emp.department];
      
      const [result] = await conn.query(
        `INSERT INTO users (
          email, password_hash, first_name, last_name,
          role, employee_id, position, hourly_rate, is_active
        ) VALUES (?, ?, ?, ?, 'employee', ?, ?, ?, TRUE)`,
        [
          emp.email, hashedPassword, emp.firstName, emp.lastName,
          `EMP${String(i + 1).padStart(3, '0')}`,
          emp.position, emp.hourlyRate
        ]
      );
      
      const userId = (result as any).insertId;
      userIds.push(userId);
      
      // Link user to department
      await conn.query(
        'INSERT INTO user_departments (user_id, department_id) VALUES (?, ?)',
        [userId, deptId]
      );
      
      // Add user skills
      for (const skillName of emp.skills) {
        const skillId = skillIds[skillName];
        if (skillId) {
          await conn.query(
            'INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)',
            [userId, skillId]
          );
        }
      }
      
      // Add user preferences
      await conn.query(
        `INSERT INTO user_preferences (
          user_id, max_hours_per_week, min_hours_per_week, max_consecutive_days
        ) VALUES (?, ?, 0, 5)`,
        [userId, emp.maxHours]
      );
      
      // Add some unavailability periods (randomly for 20% of users)
      if (Math.random() < 0.2) {
        const dayOffset = Math.floor(Math.random() * 28) + 1;
        const startDate = new Date(2025, 10, dayOffset); // November 2025
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + Math.floor(Math.random() * 2) + 1);
        
        await conn.query(
          'INSERT INTO user_unavailability (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
          [userId, startDate, endDate, 'Personal time off']
        );
      }
      
      console.log(`   ✓ ${emp.firstName} ${emp.lastName} - ${emp.position} (${emp.department})`);
    }
    
    console.log(`\n   📊 Total users created: ${userIds.length}`);
    
    // 5. Create Schedule
    console.log('\n📅 Creating schedule...');
    const [scheduleResult] = await conn.query(
      `INSERT INTO schedules (
        name, description, start_date, end_date, status, created_by
      ) VALUES (?, ?, ?, ?, 'draft', ?)`,
      [
        'Demo November 2025 Schedule',
        'Demo schedule for November 2025 with 150+ shifts',
        new Date('2025-11-01'),
        new Date('2025-11-30'),
        adminId
      ]
    );
    const scheduleId = (scheduleResult as any).insertId;
    console.log(`   ✓ Schedule created (ID: ${scheduleId})`);
    
    // 6. Create Shift Templates
    console.log('\n📋 Creating shift templates...');
    const shiftTemplates: Array<{ name: string; deptCode: string; startTime: string; endTime: string; minStaff: number; maxStaff: number }> = [
      { name: 'Demo Morning Shift', deptCode: 'IT', startTime: '08:00:00', endTime: '16:00:00', minStaff: 2, maxStaff: 5 },
      { name: 'Demo Afternoon Shift', deptCode: 'IT', startTime: '12:00:00', endTime: '20:00:00', minStaff: 2, maxStaff: 4 },
      { name: 'Demo Day Shift', deptCode: 'HR', startTime: '09:00:00', endTime: '17:00:00', minStaff: 1, maxStaff: 3 },
      { name: 'Demo Operations Shift', deptCode: 'OPS', startTime: '07:00:00', endTime: '15:00:00', minStaff: 2, maxStaff: 4 },
      { name: 'Demo Sales Shift', deptCode: 'SALES', startTime: '10:00:00', endTime: '18:00:00', minStaff: 2, maxStaff: 5 },
      { name: 'Demo Support Morning', deptCode: 'CS', startTime: '08:00:00', endTime: '16:00:00', minStaff: 3, maxStaff: 6 },
      { name: 'Demo Support Evening', deptCode: 'CS', startTime: '16:00:00', endTime: '00:00:00', minStaff: 2, maxStaff: 4 }
    ];
    
    const templateIds: number[] = [];
    for (const template of shiftTemplates) {
      const [result] = await conn.query(
        `INSERT INTO shift_templates (
          name, department_id, start_time, end_time, min_staff, max_staff, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [
          template.name,
          departmentIds[template.deptCode],
          template.startTime,
          template.endTime,
          template.minStaff,
          template.maxStaff
        ]
      );
      templateIds.push((result as any).insertId);
      console.log(`   ✓ ${template.name}`);
    }
    
    // 7. Create Shifts (5 shifts per day for 30 days = 150 shifts)
    console.log('\n📆 Creating shifts for November 2025...');
    let shiftCount = 0;
    
    for (let day = 1; day <= 30; day++) {
      const date = new Date(2025, 10, day); // November 2025
      
      // Create 5 shifts per day across different departments
      const dailyShifts = [
        { templateIdx: 0, deptCode: 'IT' },      // Morning IT
        { templateIdx: 1, deptCode: 'IT' },      // Afternoon IT
        { templateIdx: 2, deptCode: 'HR' },      // Day HR
        { templateIdx: 3, deptCode: 'OPS' },     // Operations
        { templateIdx: 4, deptCode: 'SALES' }    // Sales
      ];
      
      // Add extra support shifts on weekdays
      if (date.getDay() >= 1 && date.getDay() <= 5) {
        dailyShifts.push({ templateIdx: 5, deptCode: 'CS' }); // Support Morning
        dailyShifts.push({ templateIdx: 6, deptCode: 'CS' }); // Support Evening
      }
      
      for (const shift of dailyShifts) {
        const template = shiftTemplates[shift.templateIdx];
        
        const [result] = await conn.query(
          `INSERT INTO shifts (
            schedule_id, department_id, template_id, date,
            start_time, end_time, min_staff, max_staff, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
          [
            scheduleId,
            departmentIds[shift.deptCode],
            templateIds[shift.templateIdx],
            date,
            template.startTime,
            template.endTime,
            template.minStaff,
            template.maxStaff
          ]
        );
        shiftCount++;
      }
    }
    
    console.log(`   ✓ Created ${shiftCount} shifts`);
    
    // 8. Create some audit log entries
    console.log('\n📝 Creating audit logs...');
    const auditActions = [
      { action: 'user_created', description: 'Demo user account created', entityType: 'user' },
      { action: 'department_created', description: 'Demo department created', entityType: 'department' },
      { action: 'schedule_created', description: 'Demo schedule created', entityType: 'schedule' },
      { action: 'shift_created', description: 'Demo shift created', entityType: 'shift' }
    ];
    
    for (let i = 0; i < 10; i++) {
      const audit = auditActions[Math.floor(Math.random() * auditActions.length)];
      const userId = i < userIds.length ? userIds[i] : adminId;
      
      await conn.query(
        `INSERT INTO audit_logs (
          user_id, action, entity_type, entity_id, description, ip_address
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, audit.action, audit.entityType, i + 1, audit.description, '127.0.0.1']
      );
    }
    console.log(`   ✓ Created audit log entries`);
    
    // Summary
    console.log('\n✅ Demo data installation complete!\n');
    console.log('Summary:');
    console.log(`   • Departments: ${DEPARTMENTS.length}`);
    console.log(`   • Skills: ${SKILLS.length}`);
    console.log(`   • Users: ${userIds.length}`);
    console.log(`   • Shift Templates: ${templateIds.length}`);
    console.log(`   • Shifts: ${shiftCount}`);
    console.log(`   • Schedule: November 2025\n`);
    console.log('Test credentials:');
    console.log('   Admin: admin@staffscheduler.com / admin123');
    console.log('   Employee: john.smith@company.com / demo123\n');
    
  } catch (error) {
    console.error('❌ Error installing demo data:', error);
    throw error;
  }
}

async function removeDemoData(conn: mysql.Connection) {
  console.log('\n🗑️  Removing demo data...\n');
  
  try {
    console.log('📝 Deleting data...');
    
    // Delete in reverse order of foreign keys
    await conn.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE "%@company.com")');
    await conn.query('DELETE FROM shift_assignments');
    await conn.query('DELETE FROM user_unavailability WHERE user_id IN (SELECT id FROM users WHERE email LIKE "%@company.com")');
    await conn.query('DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE "%@company.com")');
    await conn.query('DELETE FROM user_skills WHERE user_id IN (SELECT id FROM users WHERE email LIKE "%@company.com")');
    await conn.query('DELETE FROM shift_skills');
    await conn.query('DELETE FROM shifts WHERE schedule_id IN (SELECT id FROM schedules WHERE name LIKE "%Demo%")');
    await conn.query('DELETE FROM schedules WHERE name LIKE "%Demo%"');
    await conn.query('DELETE FROM shift_template_skills');
    await conn.query('DELETE FROM shift_templates WHERE name LIKE "%Demo%"');
    await conn.query('DELETE FROM user_departments WHERE user_id IN (SELECT id FROM users WHERE email LIKE "%@company.com")');
    await conn.query('DELETE FROM users WHERE email LIKE "%@company.com" AND role = "employee"');
    await conn.query('DELETE FROM skills WHERE id NOT IN (SELECT DISTINCT skill_id FROM user_skills)');
    await conn.query('DELETE FROM departments WHERE name IN (?, ?, ?, ?, ?)',
      [DEPARTMENTS[0].name, DEPARTMENTS[1].name, DEPARTMENTS[2].name, DEPARTMENTS[3].name, DEPARTMENTS[4].name]);
    
    console.log('\n✅ Demo data removed successfully!\n');
    
  } catch (error) {
    console.error('❌ Error removing demo data:', error);
    throw error;
  }
}

async function showReport(conn: mysql.Connection) {
  console.log('\n📊 Demo Data Report\n');
  console.log('='.repeat(60));
  
  try {
    // Overall stats
    const [depts] = await conn.query('SELECT COUNT(*) as count FROM departments');
    const [skills] = await conn.query('SELECT COUNT(*) as count FROM skills');
    const [users] = await conn.query('SELECT COUNT(*) as count FROM users WHERE role = "employee"');
    const [schedules] = await conn.query('SELECT COUNT(*) as count FROM schedules');
    const [shifts] = await conn.query('SELECT COUNT(*) as count FROM shifts');
    const [assignments] = await conn.query('SELECT COUNT(*) as count FROM shift_assignments');
    
    console.log('\nOverall Statistics:');
    console.log(`  Departments:      ${(depts as any)[0].count}`);
    console.log(`  Skills:           ${(skills as any)[0].count}`);
    console.log(`  Users/Employees:  ${(users as any)[0].count}`);
    console.log(`  Schedules:        ${(schedules as any)[0].count}`);
    console.log(`  Shifts:           ${(shifts as any)[0].count}`);
    console.log(`  Assignments:      ${(assignments as any)[0].count}`);
    
    // By department
    console.log('\nBy Department:');
    const [deptStats] = await conn.query(`
      SELECT d.name, COUNT(DISTINCT ud.user_id) as employee_count
      FROM departments d
      LEFT JOIN user_departments ud ON d.id = ud.department_id
      GROUP BY d.id, d.name
      ORDER BY d.name
    `);
    
    for (const row of deptStats as any[]) {
      console.log(`  ${row.name.padEnd(25)} ${row.employee_count} employees`);
    }
    
    // User preferences stats
    const [prefStats] = await conn.query(`
      SELECT 
        AVG(max_hours_per_week) as avg_max_hours,
        AVG(max_consecutive_days) as avg_max_days
      FROM user_preferences
    `);
    
    console.log('\nPreference Averages:');
    console.log(`  Max hours/week:   ${Math.round((prefStats as any[])[0].avg_max_hours)}`);
    console.log(`  Max consec. days: ${Math.round((prefStats as any[])[0].avg_max_days)}`);
    
    console.log('\n' + '='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('❌ Error generating report:', error);
    throw error;
  }
}

async function main() {
  const command = process.argv[2] || 'install';
  
  let connection: mysql.Connection | null = null;
  
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('✓ Connected to database\n');
    
    switch (command) {
      case 'install':
        await installDemoData(connection);
        break;
        
      case 'remove':
        await removeDemoData(connection);
        break;
        
      case 'report':
        await showReport(connection);
        break;
        
      default:
        console.log('Unknown command. Use: install, remove, or report');
        process.exit(1);
    }
    
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Make sure Docker and MySQL are running:');
      console.error('   docker-compose up -d mysql\n');
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { installDemoData, removeDemoData, showReport };
