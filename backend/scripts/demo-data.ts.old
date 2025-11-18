#!/usr/bin/env node

/**
 * Demo Data Script for StaffScheduler
 * Adds sample data with various user profiles and requirements
 * Easy to add and remove from the real database
 */

import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { config } from '../src/config';

interface DemoUser {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  parentSupervisor?: string;
  hierarchyLevel: number;
  hierarchyPath: string;
  maxSubordinateLevel?: number;
}

interface DemoEmployee {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  hireDate: string;
  workPatterns: any;
  skills: string[];
  preferences: any;
  emergencyContact: any;
}

interface DemoShift {
  name: string;
  startTime: string;
  endTime: string;
  date: string;
  department: string;
  position: string;
  requiredSkills: string[];
  minimumStaff: number;
  maximumStaff: number;
}

class DemoDataGenerator {
  private connection: mysql.Connection | null = null;
  private saltRounds = 12;

  // Demo data definitions
  private demoUsers: DemoUser[] = [
    // Admin (Super Administrator)
    {
      username: 'admin',
      email: 'admin@staffscheduler.demo',
      password: 'Admin123!',
      firstName: 'Marco',
      lastName: 'Rossi',
      role: 'admin',
      hierarchyLevel: 0,
      hierarchyPath: '0',
      maxSubordinateLevel: 10
    },

    // Regional Manager
    {
      username: 'manager.north',
      email: 'manager.north@staffscheduler.demo',
      password: 'Manager123!',
      firstName: 'Laura',
      lastName: 'Bianchi',
      role: 'manager',
      parentSupervisor: 'admin',
      hierarchyLevel: 1,
      hierarchyPath: '0.1',
      maxSubordinateLevel: 3
    },

    // Store Manager
    {
      username: 'manager.store1',
      email: 'manager.store1@staffscheduler.demo',
      password: 'Store123!',
      firstName: 'Giuseppe',
      lastName: 'Verdi',
      role: 'manager',
      employeeId: 'EMP001',
      parentSupervisor: 'manager.north',
      hierarchyLevel: 2,
      hierarchyPath: '0.1.1',
      maxSubordinateLevel: 1
    },

    // Team Leader/Supervisor
    {
      username: 'supervisor.sales',
      email: 'supervisor.sales@staffscheduler.demo',
      password: 'Super123!',
      firstName: 'Maria',
      lastName: 'Ferrari',
      role: 'manager',
      employeeId: 'EMP002',
      parentSupervisor: 'manager.store1',
      hierarchyLevel: 3,
      hierarchyPath: '0.1.1.1',
      maxSubordinateLevel: 0
    },

    // Senior Employees
    {
      username: 'alice.senior',
      email: 'alice.senior@staffscheduler.demo',
      password: 'Employee123!',
      firstName: 'Alice',
      lastName: 'Neri',
      role: 'employee',
      employeeId: 'EMP003',
      parentSupervisor: 'supervisor.sales',
      hierarchyLevel: 4,
      hierarchyPath: '0.1.1.1.1'
    },

    // Regular Employees with different profiles
    {
      username: 'bob.parttime',
      email: 'bob.parttime@staffscheduler.demo',
      password: 'Employee123!',
      firstName: 'Roberto',
      lastName: 'Blu',
      role: 'employee',
      employeeId: 'EMP004',
      parentSupervisor: 'supervisor.sales',
      hierarchyLevel: 4,
      hierarchyPath: '0.1.1.1.2'
    },

    {
      username: 'carla.student',
      email: 'carla.student@staffscheduler.demo',
      password: 'Employee123!',
      firstName: 'Carla',
      lastName: 'Giallo',
      role: 'employee',
      employeeId: 'EMP005',
      parentSupervisor: 'supervisor.sales',
      hierarchyLevel: 4,
      hierarchyPath: '0.1.1.1.3'
    },

    {
      username: 'david.fulltime',
      email: 'david.fulltime@staffscheduler.demo',
      password: 'Employee123!',
      firstName: 'Davide',
      lastName: 'Verde',
      role: 'employee',
      employeeId: 'EMP006',
      parentSupervisor: 'supervisor.sales',
      hierarchyLevel: 4,
      hierarchyPath: '0.1.1.1.4'
    },

    // Another department
    {
      username: 'supervisor.logistics',
      email: 'supervisor.logistics@staffscheduler.demo',
      password: 'Super123!',
      firstName: 'Francesco',
      lastName: 'Viola',
      role: 'manager',
      employeeId: 'EMP007',
      parentSupervisor: 'manager.store1',
      hierarchyLevel: 3,
      hierarchyPath: '0.1.1.2'
    },

    {
      username: 'emma.logistics',
      email: 'emma.logistics@staffscheduler.demo',
      password: 'Employee123!',
      firstName: 'Emma',
      lastName: 'Rosa',
      role: 'employee',
      employeeId: 'EMP008',
      parentSupervisor: 'supervisor.logistics',
      hierarchyLevel: 4,
      hierarchyPath: '0.1.1.2.1'
    }
  ];

  private demoEmployees: DemoEmployee[] = [
    {
      employeeId: 'EMP001',
      firstName: 'Giuseppe',
      lastName: 'Verdi',
      email: 'manager.store1@staffscheduler.demo',
      phone: '+39 333 1234567',
      position: 'Store Manager',
      department: 'Management',
      hireDate: '2020-01-15',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon'],
        maxHoursPerWeek: 40,
        minHoursPerWeek: 35,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      },
      skills: ['management', 'customer_service', 'sales', 'inventory'],
      preferences: {
        preferredDepartments: ['sales', 'management'],
        avoidNightShifts: false,
        flexibleSchedule: true
      },
      emergencyContact: {
        name: 'Lucia Verdi',
        phone: '+39 333 7654321',
        relationship: 'spouse'
      }
    },

    {
      employeeId: 'EMP002',
      firstName: 'Maria',
      lastName: 'Ferrari',
      email: 'supervisor.sales@staffscheduler.demo',
      phone: '+39 333 2345678',
      position: 'Sales Supervisor',
      department: 'Sales',
      hireDate: '2021-03-10',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon'],
        maxHoursPerWeek: 40,
        minHoursPerWeek: 30,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      },
      skills: ['sales', 'customer_service', 'team_leadership', 'cash_handling'],
      preferences: {
        preferredDepartments: ['sales'],
        avoidNightShifts: true,
        flexibleSchedule: false
      },
      emergencyContact: {
        name: 'Paolo Ferrari',
        phone: '+39 333 8765432',
        relationship: 'brother'
      }
    },

    {
      employeeId: 'EMP003',
      firstName: 'Alice',
      lastName: 'Neri',
      email: 'alice.senior@staffscheduler.demo',
      phone: '+39 333 3456789',
      position: 'Senior Sales Associate',
      department: 'Sales',
      hireDate: '2019-06-01',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon', 'evening'],
        maxHoursPerWeek: 38,
        minHoursPerWeek: 32,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      },
      skills: ['sales', 'customer_service', 'cash_handling', 'product_knowledge', 'training'],
      preferences: {
        preferredDepartments: ['sales', 'customer_service'],
        avoidNightShifts: false,
        flexibleSchedule: true
      },
      emergencyContact: {
        name: 'Gianni Neri',
        phone: '+39 333 9876543',
        relationship: 'father'
      }
    },

    {
      employeeId: 'EMP004',
      firstName: 'Roberto',
      lastName: 'Blu',
      email: 'bob.parttime@staffscheduler.demo',
      phone: '+39 333 4567890',
      position: 'Part-time Sales Associate',
      department: 'Sales',
      hireDate: '2022-09-15',
      workPatterns: {
        preferredShifts: ['evening'],
        maxHoursPerWeek: 20,
        minHoursPerWeek: 15,
        availableDays: ['wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      skills: ['sales', 'customer_service', 'cash_handling'],
      preferences: {
        preferredDepartments: ['sales'],
        avoidNightShifts: true,
        flexibleSchedule: false,
        notes: 'Part-time student, available only evenings and weekends'
      },
      emergencyContact: {
        name: 'Anna Blu',
        phone: '+39 333 1098765',
        relationship: 'mother'
      }
    },

    {
      employeeId: 'EMP005',
      firstName: 'Carla',
      lastName: 'Giallo',
      email: 'carla.student@staffscheduler.demo',
      phone: '+39 333 5678901',
      position: 'Student Worker',
      department: 'Sales',
      hireDate: '2023-01-20',
      workPatterns: {
        preferredShifts: ['afternoon', 'evening'],
        maxHoursPerWeek: 25,
        minHoursPerWeek: 10,
        availableDays: ['friday', 'saturday', 'sunday'],
        restrictions: ['no_morning_shifts_weekdays', 'university_schedule']
      },
      skills: ['customer_service', 'basic_sales'],
      preferences: {
        preferredDepartments: ['sales', 'customer_service'],
        avoidNightShifts: true,
        flexibleSchedule: true,
        notes: 'University student, very flexible on weekends, limited weekday availability'
      },
      emergencyContact: {
        name: 'Mario Giallo',
        phone: '+39 333 2109876',
        relationship: 'father'
      }
    },

    {
      employeeId: 'EMP006',
      firstName: 'Davide',
      lastName: 'Verde',
      email: 'david.fulltime@staffscheduler.demo',
      phone: '+39 333 6789012',
      position: 'Full-time Sales Associate',
      department: 'Sales',
      hireDate: '2021-11-08',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon', 'evening'],
        maxHoursPerWeek: 40,
        minHoursPerWeek: 35,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      },
      skills: ['sales', 'customer_service', 'cash_handling', 'inventory', 'merchandising'],
      preferences: {
        preferredDepartments: ['sales', 'inventory'],
        avoidNightShifts: false,
        flexibleSchedule: true,
        notes: 'Reliable full-time employee, willing to work overtime when needed'
      },
      emergencyContact: {
        name: 'Sara Verde',
        phone: '+39 333 3210987',
        relationship: 'spouse'
      }
    },

    {
      employeeId: 'EMP007',
      firstName: 'Francesco',
      lastName: 'Viola',
      email: 'supervisor.logistics@staffscheduler.demo',
      phone: '+39 333 7890123',
      position: 'Logistics Supervisor',
      department: 'Logistics',
      hireDate: '2020-07-22',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon'],
        maxHoursPerWeek: 40,
        minHoursPerWeek: 35,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      },
      skills: ['logistics', 'inventory', 'team_leadership', 'warehouse_management', 'forklift'],
      preferences: {
        preferredDepartments: ['logistics', 'warehouse'],
        avoidNightShifts: true,
        flexibleSchedule: false
      },
      emergencyContact: {
        name: 'Alessia Viola',
        phone: '+39 333 4321098',
        relationship: 'spouse'
      }
    },

    {
      employeeId: 'EMP008',
      firstName: 'Emma',
      lastName: 'Rosa',
      email: 'emma.logistics@staffscheduler.demo',
      phone: '+39 333 8901234',
      position: 'Warehouse Associate',
      department: 'Logistics',
      hireDate: '2022-02-14',
      workPatterns: {
        preferredShifts: ['morning', 'afternoon'],
        maxHoursPerWeek: 35,
        minHoursPerWeek: 28,
        availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      },
      skills: ['warehouse_operations', 'inventory', 'packing', 'basic_forklift'],
      preferences: {
        preferredDepartments: ['logistics', 'warehouse'],
        avoidNightShifts: true,
        flexibleSchedule: true,
        notes: 'Prefers consistent schedule, good at inventory management'
      },
      emergencyContact: {
        name: 'Matteo Rosa',
        phone: '+39 333 5432109',
        relationship: 'brother'
      }
    }
  ];

  private demoShifts: DemoShift[] = [
    // Morning shifts
    {
      name: 'Morning Sales',
      startTime: '08:00',
      endTime: '16:00',
      date: '2024-01-15',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service'],
      minimumStaff: 2,
      maximumStaff: 4
    },
    {
      name: 'Morning Logistics',
      startTime: '07:00',
      endTime: '15:00',
      date: '2024-01-15',
      department: 'Logistics',
      position: 'Warehouse Associate',
      requiredSkills: ['warehouse_operations', 'inventory'],
      minimumStaff: 1,
      maximumStaff: 2
    },

    // Afternoon shifts
    {
      name: 'Afternoon Sales',
      startTime: '14:00',
      endTime: '22:00',
      date: '2024-01-15',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service', 'cash_handling'],
      minimumStaff: 3,
      maximumStaff: 5
    },

    // Evening shifts
    {
      name: 'Evening Sales',
      startTime: '16:00',
      endTime: '22:00',
      date: '2024-01-15',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service'],
      minimumStaff: 2,
      maximumStaff: 3
    },

    // Weekend shifts
    {
      name: 'Saturday Morning',
      startTime: '09:00',
      endTime: '17:00',
      date: '2024-01-20',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service'],
      minimumStaff: 3,
      maximumStaff: 6
    },
    {
      name: 'Saturday Afternoon',
      startTime: '13:00',
      endTime: '21:00',
      date: '2024-01-20',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service'],
      minimumStaff: 4,
      maximumStaff: 6
    },

    {
      name: 'Sunday Morning',
      startTime: '10:00',
      endTime: '18:00',
      date: '2024-01-21',
      department: 'Sales',
      position: 'Sales Associate',
      requiredSkills: ['sales', 'customer_service'],
      minimumStaff: 2,
      maximumStaff: 4
    }
  ];

  async connect(): Promise<void> {
    this.connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });
    console.log('✅ Connected to MySQL database');
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      console.log('✅ Disconnected from MySQL database');
    }
  }

  async clearDemoData(): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');

    console.log('🧹 Clearing existing demo data...');

    // Clear in reverse order due to foreign key constraints
    await this.connection.execute('DELETE FROM shift_assignments WHERE employee_id LIKE "EMP%"');
    await this.connection.execute('DELETE FROM shifts WHERE created_by LIKE "%demo" OR name LIKE "%Sales%" OR name LIKE "%Logistics%"');
    await this.connection.execute('DELETE FROM employees WHERE employee_id LIKE "EMP%"');
    await this.connection.execute('DELETE FROM users WHERE email LIKE "%@staffscheduler.demo"');

    console.log('✅ Demo data cleared');
  }

  async createDemoUsers(): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');

    console.log('👥 Creating demo users...');

    for (const userData of this.demoUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, this.saltRounds);
      
      await this.connection.execute(`
        INSERT INTO users (
          username, email, password_hash, first_name, last_name, role,
          employee_id, parent_supervisor, hierarchy_level, hierarchy_path,
          max_subordinate_level, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
      `, [
        userData.username,
        userData.email,
        hashedPassword,
        userData.firstName,
        userData.lastName,
        userData.role,
        userData.employeeId || null,
        userData.parentSupervisor || null,
        userData.hierarchyLevel,
        userData.hierarchyPath,
        userData.maxSubordinateLevel || null
      ]);

      console.log(`  ✅ Created user: ${userData.username} (${userData.role})`);
    }

    console.log('✅ All demo users created');
  }

  async createDemoEmployees(): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');

    console.log('👷 Creating demo employees...');

    for (const empData of this.demoEmployees) {
      await this.connection.execute(`
        INSERT INTO employees (
          employee_id, first_name, last_name, email, phone, position,
          department, hire_date, work_patterns, skills, preferences,
          emergency_contact, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
      `, [
        empData.employeeId,
        empData.firstName,
        empData.lastName,
        empData.email,
        empData.phone,
        empData.position,
        empData.department,
        empData.hireDate,
        JSON.stringify(empData.workPatterns),
        JSON.stringify(empData.skills),
        JSON.stringify(empData.preferences),
        JSON.stringify(empData.emergencyContact)
      ]);

      console.log(`  ✅ Created employee: ${empData.firstName} ${empData.lastName} (${empData.position})`);
    }

    console.log('✅ All demo employees created');
  }

  async createDemoShifts(): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');

    console.log('📅 Creating demo shifts...');

    // Get admin user ID for created_by field
    const [adminResult] = await this.connection.execute(
      'SELECT id FROM users WHERE username = "admin"'
    ) as any;
    
    if (!adminResult.length) {
      throw new Error('Admin user not found');
    }
    
    const adminId = adminResult[0].id;

    for (const shiftData of this.demoShifts) {
      await this.connection.execute(`
        INSERT INTO shifts (
          name, start_time, end_time, date, department, position,
          required_skills, minimum_staff, maximum_staff, status,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), NOW())
      `, [
        shiftData.name,
        shiftData.startTime,
        shiftData.endTime,
        shiftData.date,
        shiftData.department,
        shiftData.position,
        JSON.stringify(shiftData.requiredSkills),
        shiftData.minimumStaff,
        shiftData.maximumStaff,
        adminId
      ]);

      console.log(`  ✅ Created shift: ${shiftData.name} on ${shiftData.date}`);
    }

    console.log('✅ All demo shifts created');
  }

  async generateReport(): Promise<void> {
    if (!this.connection) throw new Error('Not connected to database');

    console.log('\n📊 DEMO DATA SUMMARY');
    console.log('==========================================');

    // Users summary
    const [users] = await this.connection.execute(
      'SELECT role, COUNT(*) as count FROM users WHERE email LIKE "%@staffscheduler.demo" GROUP BY role'
    ) as any;

    console.log('\n👥 Users created:');
    users.forEach((row: any) => {
      console.log(`  ${row.role}: ${row.count}`);
    });

    // Employees summary
    const [employees] = await this.connection.execute(
      'SELECT department, COUNT(*) as count FROM employees WHERE employee_id LIKE "EMP%" GROUP BY department'
    ) as any;

    console.log('\n👷 Employees by department:');
    employees.forEach((row: any) => {
      console.log(`  ${row.department}: ${row.count}`);
    });

    // Shifts summary
    const [shifts] = await this.connection.execute(
      'SELECT department, COUNT(*) as count FROM shifts WHERE name LIKE "%Sales%" OR name LIKE "%Logistics%" GROUP BY department'
    ) as any;

    console.log('\n📅 Shifts by department:');
    shifts.forEach((row: any) => {
      console.log(`  ${row.department}: ${row.count}`);
    });

    console.log('\n🔐 TEST CREDENTIALS:');
    console.log('==========================================');
    console.log('Admin: admin / Admin123!');
    console.log('Manager: manager.north / Manager123!');
    console.log('Store Manager: manager.store1 / Store123!');
    console.log('Employee: alice.senior / Employee123!');
    console.log('Part-time: bob.parttime / Employee123!');
    console.log('Student: carla.student / Employee123!');
    console.log('');
    console.log('🌐 Access the app at: http://localhost:3000');
    console.log('📡 API endpoint: http://localhost:5000/api');
  }

  async run(action: string): Promise<void> {
    try {
      await this.connect();

      switch (action) {
        case 'install':
          await this.clearDemoData();
          await this.createDemoUsers();
          await this.createDemoEmployees();
          await this.createDemoShifts();
          await this.generateReport();
          break;

        case 'remove':
          await this.clearDemoData();
          console.log('✅ All demo data removed');
          break;

        case 'report':
          await this.generateReport();
          break;

        default:
          console.log('Usage: npm run demo [install|remove|report]');
          console.log('  install - Add all demo data');
          console.log('  remove  - Remove all demo data');
          console.log('  report  - Show demo data summary');
      }

    } catch (error) {
      console.error('❌ Error:', (error as Error).message);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

// Run the script
const action = process.argv[2] || 'install';
const generator = new DemoDataGenerator();
generator.run(action);
