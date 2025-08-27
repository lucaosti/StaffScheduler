-- Staff Scheduler Database Schema
-- MySQL 8.0 compatible
-- Initial setup script

CREATE DATABASE IF NOT EXISTS staff_scheduler;
USE staff_scheduler;

-- Users table with N-level hierarchy support
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  role ENUM('master', 'supervisor', 'employee') NOT NULL,
  employee_id VARCHAR(36),
  parent_supervisor VARCHAR(36) NULL,
  hierarchy_level INT NOT NULL DEFAULT 0,
  hierarchy_path VARCHAR(500) NOT NULL, -- Materialized path: "0.1.3.7"
  max_subordinate_level INT NULL, -- How deep they can create users
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(36) NULL,
  last_login TIMESTAMP NULL,
  reset_token VARCHAR(255) NULL,
  reset_token_expiry TIMESTAMP NULL,
  notification_token VARCHAR(500) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  INDEX idx_email (email),
  INDEX idx_hierarchy_path (hierarchy_path),
  INDEX idx_parent (parent_supervisor),
  INDEX idx_level (hierarchy_level),
  FOREIGN KEY (parent_supervisor) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Hierarchy paths for efficient queries (materialized view)
CREATE TABLE hierarchy_paths (
  descendant_id VARCHAR(36),
  ancestor_id VARCHAR(36),
  depth INT,
  PRIMARY KEY (descendant_id, ancestor_id),
  FOREIGN KEY (descendant_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ancestor_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_descendant (descendant_id),
  INDEX idx_ancestor (ancestor_id),
  INDEX idx_depth (depth)
);

-- Delegated authorities
CREATE TABLE delegated_authorities (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('forced_assignment', 'availability_override', 'constraint_exception') NOT NULL,
  target_employee_id VARCHAR(36) NULL,
  target_shift_id VARCHAR(36) NULL,
  target_time_start DATETIME NULL,
  target_time_end DATETIME NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at DATETIME NULL,
  delegated_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (delegated_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_delegated_by (delegated_by),
  INDEX idx_expires (expires_at)
);

-- User permissions
CREATE TABLE user_permissions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  resource ENUM('employees', 'shifts', 'schedules', 'reports', 'settings', 'users') NOT NULL,
  action ENUM('read', 'write', 'delete', 'approve', 'create_user') NOT NULL,
  scope ENUM('all', 'hierarchy_down', 'unit', 'self') NOT NULL DEFAULT 'self',
  conditions JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_resource (user_id, resource),
  INDEX idx_user_action (user_id, action)
);

-- Organizational units
CREATE TABLE organizational_units (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_unit_id VARCHAR(36) NULL,
  hierarchy_path VARCHAR(500) NOT NULL,
  manager_id VARCHAR(36) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_unit_id) REFERENCES organizational_units(id),
  FOREIGN KEY (manager_id) REFERENCES users(id),
  INDEX idx_parent (parent_unit_id),
  INDEX idx_hierarchy (hierarchy_path),
  INDEX idx_manager (manager_id)
);

-- Roles (job roles, not user roles)
CREATE TABLE roles (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  default_rest_hours INT DEFAULT 12, -- Minimum rest between shifts
  color_code VARCHAR(7), -- Hex color for UI
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees
CREATE TABLE employees (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  contract_from DATE NOT NULL,
  contract_to DATE NOT NULL,
  rest_hours INT NULL, -- Override default role rest hours
  is_active BOOLEAN DEFAULT TRUE,
  primary_unit VARCHAR(36) NOT NULL,
  primary_supervisor VARCHAR(36) NOT NULL,
  hierarchy_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (primary_unit) REFERENCES organizational_units(id),
  FOREIGN KEY (primary_supervisor) REFERENCES users(id),
  INDEX idx_email (email),
  INDEX idx_unit (primary_unit),
  INDEX idx_supervisor (primary_supervisor),
  INDEX idx_hierarchy (hierarchy_path),
  INDEX idx_active (is_active)
);

-- Employee roles (many-to-many)
CREATE TABLE employee_roles (
  employee_id VARCHAR(36),
  role_id VARCHAR(36),
  is_primary BOOLEAN DEFAULT FALSE,
  skill_level ENUM('basic', 'intermediate', 'advanced', 'expert') DEFAULT 'basic',
  certified_at DATE NULL,
  PRIMARY KEY (employee_id, role_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  INDEX idx_employee (employee_id),
  INDEX idx_role (role_id)
);

-- Employee secondary units (matrix organization)
CREATE TABLE employee_secondary_units (
  employee_id VARCHAR(36),
  unit_id VARCHAR(36),
  supervisor_id VARCHAR(36) NULL,
  allocation_percent INT DEFAULT 0, -- % of time allocated to this unit
  start_date DATE NOT NULL,
  end_date DATE NULL,
  PRIMARY KEY (employee_id, unit_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES organizational_units(id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id),
  INDEX idx_employee (employee_id),
  INDEX idx_unit (unit_id)
);

-- Target hours per employee
CREATE TABLE employee_target_hours (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  horizon_type ENUM('weekly', 'monthly', 'quarterly') NOT NULL,
  target_hours DECIMAL(5,2) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_employee (employee_id),
  INDEX idx_horizon (horizon_type),
  INDEX idx_effective (effective_from, effective_to)
);

-- Shifts
CREATE TABLE shifts (
  id VARCHAR(36) PRIMARY KEY,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  type ENUM('regular', 'special') NOT NULL DEFAULT 'regular',
  special_type ENUM('on_call', 'overtime', 'emergency', 'holiday') NULL,
  priority INT DEFAULT 1, -- For constraint resolution
  location VARCHAR(255),
  description TEXT,
  unit_id VARCHAR(36) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_published BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (unit_id) REFERENCES organizational_units(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_time_range (start_time, end_time),
  INDEX idx_type (type, special_type),
  INDEX idx_unit (unit_id),
  INDEX idx_published (is_published)
);

-- Shift role requirements
CREATE TABLE shift_roles (
  id VARCHAR(36) PRIMARY KEY,
  shift_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(36) NOT NULL,
  min_required INT NOT NULL DEFAULT 1,
  max_allowed INT NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_shift (shift_id),
  INDEX idx_role (role_id),
  UNIQUE KEY unique_shift_role (shift_id, role_id)
);

-- Assignments
CREATE TABLE assignments (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  role_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by VARCHAR(36) NOT NULL,
  approved_by VARCHAR(36) NULL,
  approved_at TIMESTAMP NULL,
  rejection_reason TEXT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_employee (employee_id),
  INDEX idx_shift (shift_id),
  INDEX idx_status (status),
  INDEX idx_assigned_by (assigned_by),
  UNIQUE KEY unique_employee_shift (employee_id, shift_id)
);

-- Assignment exemptions
CREATE TABLE assignment_exemptions (
  id VARCHAR(36) PRIMARY KEY,
  assignment_id VARCHAR(36) NOT NULL,
  constraint_type VARCHAR(100) NOT NULL,
  constraint_id VARCHAR(36) NULL,
  exemption_reason TEXT NOT NULL,
  approved_by VARCHAR(36) NOT NULL,
  approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_assignment (assignment_id),
  INDEX idx_constraint (constraint_type, constraint_id)
);

-- Employee preferences
CREATE TABLE preferences (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  type ENUM('day_off', 'avoid_interval', 'preferred_shift', 'max_consecutive') NOT NULL,
  priority TINYINT NOT NULL DEFAULT 2, -- 1 = highest, 3 = lowest
  time_start DATETIME NULL,
  time_end DATETIME NULL,
  weekly_pattern JSON NULL, -- For recurring patterns
  value INT NULL, -- For numeric preferences
  is_active BOOLEAN DEFAULT TRUE,
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_employee (employee_id),
  INDEX idx_type (type),
  INDEX idx_valid_period (valid_from, valid_to),
  INDEX idx_active (is_active)
);

-- Legal/Union constraints
CREATE TABLE legal_constraints (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type ENUM('max_consecutive_days', 'min_rest_hours', 'max_weekly_hours', 'max_monthly_hours') NOT NULL,
  value DECIMAL(8,2) NOT NULL,
  applies_to ENUM('all', 'role', 'employee', 'unit') NOT NULL,
  target_id VARCHAR(36) NULL, -- role_id, employee_id, or unit_id
  hierarchy_level INT NOT NULL DEFAULT 0,
  organization_unit VARCHAR(36) NOT NULL,
  can_override BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_unit) REFERENCES organizational_units(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_type (type),
  INDEX idx_applies_to (applies_to, target_id),
  INDEX idx_hierarchy (hierarchy_level),
  INDEX idx_unit (organization_unit)
);

-- Schedule generations
CREATE TABLE schedule_generations (
  id VARCHAR(36) PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  parameters JSON NOT NULL, -- ScheduleParameters serialized
  status ENUM('draft', 'approved', 'published', 'archived') DEFAULT 'draft',
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(36) NOT NULL,
  approved_by VARCHAR(36) NULL,
  approved_at TIMESTAMP NULL,
  statistics JSON NULL, -- Schedule statistics
  FOREIGN KEY (generated_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_date_range (start_date, end_date),
  INDEX idx_status (status),
  INDEX idx_generated_by (generated_by)
);

-- Schedule generation violations
CREATE TABLE schedule_violations (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  type ENUM('hard', 'soft') NOT NULL,
  constraint_id VARCHAR(36) NULL,
  employee_id VARCHAR(36) NOT NULL,
  shift_id VARCHAR(36) NULL,
  description TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES schedule_generations(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (shift_id) REFERENCES shifts(id),
  INDEX idx_schedule (schedule_id),
  INDEX idx_type (type),
  INDEX idx_severity (severity),
  INDEX idx_employee (employee_id)
);

-- Notifications
CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('schedule_change', 'shift_assignment', 'approval_request', 'reminder') NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSON NULL, -- Additional payload
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMP NULL, -- For future notifications
  sent_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_read (is_read),
  INDEX idx_scheduled (scheduled_for),
  INDEX idx_created (created_at)
);

-- Conflicts
CREATE TABLE conflicts (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('overlapping_assignments', 'constraint_violation', 'authority_dispute', 'resource_conflict') NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  resolution_strategy ENUM('manual_review', 'automatic_precedence', 'escalate_to_superior') NOT NULL,
  status ENUM('open', 'in_review', 'resolved', 'escalated') DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  resolved_by VARCHAR(36) NULL,
  resolution_notes TEXT NULL,
  FOREIGN KEY (resolved_by) REFERENCES users(id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_severity (severity),
  INDEX idx_created (created_at)
);

-- Conflict participants
CREATE TABLE conflict_participants (
  conflict_id VARCHAR(36),
  user_id VARCHAR(36),
  participant_type ENUM('employee', 'supervisor', 'mediator') NOT NULL,
  PRIMARY KEY (conflict_id, user_id),
  FOREIGN KEY (conflict_id) REFERENCES conflicts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_conflict (conflict_id),
  INDEX idx_user (user_id)
);

-- Audit logs
CREATE TABLE audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id VARCHAR(36) NOT NULL,
  changes JSON NULL, -- { field: { old: value, new: value } }
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  reason TEXT NULL, -- For sensitive operations
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user (user_id),
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_action (action)
);

-- Reports
CREATE TABLE reports (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('schedule', 'utilization', 'fairness', 'violations', 'custom') NOT NULL,
  config JSON NOT NULL, -- ReportConfig serialized
  data JSON NULL, -- Report data
  file_path VARCHAR(500) NULL, -- Path to generated file
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP NULL, -- Auto-cleanup
  FOREIGN KEY (generated_by) REFERENCES users(id),
  INDEX idx_type (type),
  INDEX idx_generated_by (generated_by),
  INDEX idx_generated_at (generated_at),
  INDEX idx_expires (expires_at)
);

-- Sessions (for Express sessions)
CREATE TABLE sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id),
  INDEX idx_expires (expires)
);

-- Insert default master user (password: admin123)
INSERT INTO users (id, email, password_hash, salt, role, hierarchy_level, hierarchy_path, created_at) VALUES 
('00000000-0000-0000-0000-000000000001', 'admin@staffscheduler.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBLOQB2D.dOKP6', 'randomsalt123', 'master', 0, '0', NOW());

-- Insert hierarchy path for master user
INSERT INTO hierarchy_paths (descendant_id, ancestor_id, depth) VALUES 
('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 0);

-- Insert master permissions
INSERT INTO user_permissions (id, user_id, resource, action, scope) VALUES 
(UUID(), '00000000-0000-0000-0000-000000000001', 'employees', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'employees', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'employees', 'delete', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'shifts', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'shifts', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'shifts', 'delete', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'schedules', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'schedules', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'schedules', 'approve', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'reports', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'reports', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'settings', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'settings', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'users', 'read', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'users', 'write', 'all'),
(UUID(), '00000000-0000-0000-0000-000000000001', 'users', 'create_user', 'all');

-- Insert default organizational unit
INSERT INTO organizational_units (id, name, description, hierarchy_path, manager_id) VALUES 
('00000000-0000-0000-0000-000000000001', 'Main Organization', 'Root organizational unit', '0', '00000000-0000-0000-0000-000000000001');

-- Insert default roles
INSERT INTO roles (id, name, description, default_rest_hours, color_code) VALUES 
(UUID(), 'Nurse', 'Registered Nurse', 12, '#3498db'),
(UUID(), 'Doctor', 'Medical Doctor', 8, '#e74c3c'),
(UUID(), 'OSS', 'Operatore Socio Sanitario', 12, '#2ecc71'),
(UUID(), 'Administrator', 'Administrative Staff', 8, '#f39c12'),
(UUID(), 'Technician', 'Medical Technician', 10, '#9b59b6');

-- Additional tables for schedules and assignments

-- Schedules table
CREATE TABLE schedules (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  created_by VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  published_by VARCHAR(36) NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (published_by) REFERENCES users(id),
  INDEX idx_status (status),
  INDEX idx_dates (start_date, end_date),
  INDEX idx_created_by (created_by)
);

-- Schedule assignments table
CREATE TABLE schedule_assignments (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  employee_id VARCHAR(36) NOT NULL,
  role VARCHAR(100) NOT NULL,
  status ENUM('assigned', 'pending', 'declined') DEFAULT 'assigned',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  assigned_by VARCHAR(36) NOT NULL,
  notes TEXT,
  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_schedule (schedule_id),
  INDEX idx_shift (shift_id),
  INDEX idx_employee (employee_id),
  INDEX idx_status (status),
  UNIQUE KEY unique_assignment (schedule_id, shift_id, employee_id)
);

-- Audit log table for tracking changes
CREATE TABLE audit_log (
  id VARCHAR(36) PRIMARY KEY,
  table_name VARCHAR(100) NOT NULL,
  record_id VARCHAR(36) NOT NULL,
  action ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
  old_values JSON,
  new_values JSON,
  user_id VARCHAR(36),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_table_record (table_name, record_id),
  INDEX idx_user (user_id),
  INDEX idx_timestamp (timestamp)
);
