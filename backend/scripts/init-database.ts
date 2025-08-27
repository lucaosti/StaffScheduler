import { database } from '../src/config/database';
import { logger } from '../src/config/logger';

const SCHEMA_SQL = `
-- Users table (authentication and basic user info)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'employee') NOT NULL DEFAULT 'employee',
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Employees table (extended employee information)
CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INT,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  department VARCHAR(100),
  position VARCHAR(100),
  hire_date DATE,
  employee_type ENUM('full-time', 'part-time', 'contractor') DEFAULT 'full-time',
  hourly_rate DECIMAL(10,2),
  max_hours_per_week INT DEFAULT 40,
  skills JSON,
  certifications JSON,
  availability_pattern JSON,
  preferences JSON,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Shifts table
CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  department VARCHAR(100),
  location VARCHAR(255),
  roles_required JSON,
  min_staff INT DEFAULT 1,
  max_staff INT,
  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  created_by INT,
  published_at TIMESTAMP NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Shift assignments table
CREATE TABLE IF NOT EXISTS shift_assignments (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  role VARCHAR(100) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by INT,
  approved_at TIMESTAMP NULL,
  approved_by INT NULL,
  rejected_at TIMESTAMP NULL,
  rejected_by INT NULL,
  rejection_reason TEXT,
  notes TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_employee_shift (employee_id, shift_id)
);

-- Time tracking table
CREATE TABLE IF NOT EXISTS time_tracking (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id VARCHAR(36) NOT NULL,
  clock_in TIMESTAMP,
  clock_out TIMESTAMP,
  break_start TIMESTAMP NULL,
  break_end TIMESTAMP NULL,
  total_hours DECIMAL(4,2),
  overtime_hours DECIMAL(4,2) DEFAULT 0,
  status ENUM('clocked_in', 'on_break', 'clocked_out') DEFAULT 'clocked_out',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE
);

-- Schedule templates table
CREATE TABLE IF NOT EXISTS schedule_templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  department VARCHAR(100),
  template_data JSON NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Employee availability table
CREATE TABLE IF NOT EXISTS employee_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  day_of_week ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Employee time off requests table
CREATE TABLE IF NOT EXISTS time_off_requests (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  request_type ENUM('vacation', 'sick', 'personal', 'holiday') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  reason TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT NULL,
  notes TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(100),
  old_values JSON,
  new_values JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_shifts_date_range ON shifts(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_shifts_department ON shifts(department);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_assignments_employee ON shift_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_shift ON shift_assignments(shift_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON shift_assignments(status);
CREATE INDEX IF NOT EXISTS idx_time_tracking_assignment ON time_tracking(assignment_id);
CREATE INDEX IF NOT EXISTS idx_availability_employee ON employee_availability(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_employee ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_dates ON time_off_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
`;

export async function initializeDatabase(): Promise<void> {
  try {
    logger.info('Starting database initialization...');

    // Test database connection
    await database.testConnection();
    logger.info('Database connection verified');

    // Execute schema creation
    const statements = SCHEMA_SQL.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await database.query(statement);
      }
    }

    logger.info('Database schema created successfully');

    // Create default admin user if it doesn't exist
    const adminExists = await database.query(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      ['admin@staffscheduler.com']
    );

    if (!adminExists || adminExists.length === 0) {
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      
      await database.query(
        'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
        ['admin@staffscheduler.com', hashedPassword, 'admin']
      );
      
      logger.info('Default admin user created: admin@staffscheduler.com / admin123');
    }

    logger.info('Database initialization completed successfully');
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      logger.info('Database initialization script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Database initialization script failed:', error);
      process.exit(1);
    });
}
