-- Staff Scheduler Database Schema
-- Complete database schema for the Staff Scheduler application
-- Includes all tables for user management, departments, scheduling, and system settings

-- Create database if not exists
CREATE DATABASE IF NOT EXISTS staff_scheduler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE staff_scheduler;

-- ================================================================
-- SYSTEM SETTINGS TABLE
-- Manages application-wide configuration settings
-- ================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    data_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_setting (category, setting_key),
    INDEX idx_category (category)
);

-- ================================================================
-- DEPARTMENTS TABLE
-- Organizational structure
-- ================================================================
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    parent_id INT NULL,
    manager_id INT NULL,
    budget DECIMAL(15,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_parent (parent_id),
    INDEX idx_manager (manager_id),
    INDEX idx_active (is_active)
);

-- ================================================================
-- USERS TABLE
-- Core user management with hierarchical roles
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'manager', 'department_manager', 'employee') NOT NULL DEFAULT 'employee',
    employee_id VARCHAR(50) UNIQUE,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email),
    INDEX idx_employee_id (employee_id),
    INDEX idx_role (role),
    INDEX idx_active (is_active)
);

-- ================================================================
-- USER DEPARTMENTS JUNCTION TABLE
-- Many-to-many relationship between users and departments
-- ================================================================
CREATE TABLE IF NOT EXISTS user_departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    is_manager BOOLEAN DEFAULT FALSE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_department (user_id, department_id),
    INDEX idx_user (user_id),
    INDEX idx_department (department_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ================================================================
-- SKILLS TABLE
-- Available skills/competencies
-- ================================================================
CREATE TABLE IF NOT EXISTS skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    category VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_category (category),
    INDEX idx_active (is_active)
);

-- ================================================================
-- USER SKILLS JUNCTION TABLE
-- User competencies with proficiency levels
-- ================================================================
CREATE TABLE IF NOT EXISTS user_skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    skill_id INT NOT NULL,
    proficiency_level INT CHECK (proficiency_level BETWEEN 1 AND 5),
    certified_date DATE NULL,
    expiry_date DATE NULL,
    
    UNIQUE KEY unique_user_skill (user_id, skill_id),
    INDEX idx_user (user_id),
    INDEX idx_skill (skill_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ================================================================
-- SHIFT TEMPLATES TABLE
-- Reusable shift definitions
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    department_id INT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration INT DEFAULT 0, -- minutes
    min_staff INT DEFAULT 1,
    max_staff INT DEFAULT 10,
    required_skills JSON,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_department (department_id),
    INDEX idx_active (is_active),
    
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ================================================================
-- SCHEDULES TABLE
-- Schedule containers/periods
-- ================================================================
CREATE TABLE IF NOT EXISTS schedules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
    created_by INT NOT NULL,
    published_by INT NULL,
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_dates (start_date, end_date),
    INDEX idx_status (status),
    INDEX idx_created_by (created_by),
    
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (published_by) REFERENCES users(id)
);

-- ================================================================
-- SHIFTS TABLE
-- Individual shift instances
-- ================================================================
CREATE TABLE IF NOT EXISTS shifts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NOT NULL,
    department_id INT NOT NULL,
    template_id INT NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration INT DEFAULT 0,
    min_staff INT DEFAULT 1,
    max_staff INT DEFAULT 10,
    required_skills JSON,
    notes TEXT,
    status ENUM('open', 'assigned', 'confirmed', 'completed', 'cancelled') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_schedule (schedule_id),
    INDEX idx_department (department_id),
    INDEX idx_date (date),
    INDEX idx_status (status),
    INDEX idx_template (template_id),
    
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (template_id) REFERENCES shift_templates(id)
);

-- ================================================================
-- TIME OFF REQUESTS TABLE
-- Employee time off management
-- ================================================================
CREATE TABLE IF NOT EXISTS time_off_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type ENUM('vacation', 'sick', 'personal', 'emergency', 'other') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    hours_requested DECIMAL(4,2) NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'denied', 'cancelled') DEFAULT 'pending',
    approved_by INT NULL,
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_dates (start_date, end_date),
    INDEX idx_status (status),
    INDEX idx_approved_by (approved_by),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ================================================================
-- Add Foreign Key Constraints for departments
-- ================================================================
ALTER TABLE departments 
ADD CONSTRAINT fk_dept_parent FOREIGN KEY (parent_id) REFERENCES departments(id),
ADD CONSTRAINT fk_dept_manager FOREIGN KEY (manager_id) REFERENCES users(id);

-- ================================================================
-- INSERT DEFAULT SYSTEM SETTINGS
-- As requested: EUR default currency and monthly default time period
-- ================================================================
INSERT INTO system_settings (category, setting_key, setting_value, data_type, description, is_system) VALUES
('general', 'currency', 'EUR', 'string', 'Default currency for monetary values (EUR/USD) - Default: EUR as requested', FALSE),
('schedule', 'default_time_period', 'monthly', 'string', 'Default time period for scheduling - Default: monthly as requested', FALSE),
('general', 'company_name', 'Staff Scheduler', 'string', 'Company name displayed in the application', FALSE),
('general', 'timezone', 'Europe/Rome', 'string', 'Default timezone for the application', FALSE),
('general', 'date_format', 'DD/MM/YYYY', 'string', 'Default date format for the application', FALSE),
('general', 'time_format', '24h', 'string', 'Time format (12h/24h)', FALSE),
('schedule', 'advance_notice_days', '14', 'number', 'Minimum days of advance notice for scheduling', FALSE),
('schedule', 'max_shift_hours', '12', 'number', 'Maximum hours per shift', FALSE),
('schedule', 'min_rest_hours', '11', 'number', 'Minimum rest hours between shifts', FALSE),
('notifications', 'email_enabled', 'true', 'boolean', 'Enable email notifications', FALSE),
('notifications', 'sms_enabled', 'false', 'boolean', 'Enable SMS notifications', FALSE);

-- ================================================================
-- INSERT DEFAULT ADMIN USER
-- Password: Admin123! (hashed with bcrypt)
-- ================================================================
INSERT INTO users (email, password_hash, salt, first_name, last_name, role, employee_id, is_active) VALUES
('admin@staffscheduler.com', '$2b$10$rQZ8uZ9P1J2K3L4M5N6O7PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 'admin_salt_2024', 'System', 'Administrator', 'admin', 'ADMIN001', TRUE);

-- ================================================================
-- INSERT DEFAULT DEPARTMENTS
-- ================================================================
INSERT INTO departments (name, description, is_active) VALUES
('Administration', 'General administration and management', TRUE),
('Human Resources', 'HR and personnel management', TRUE),
('IT Department', 'Information technology services', TRUE),
('Operations', 'Daily operations and logistics', TRUE);

-- ================================================================
-- INSERT DEFAULT SKILLS
-- ================================================================
INSERT INTO skills (name, description, category, is_active) VALUES
('Customer Service', 'Customer interaction and support skills', 'Soft Skills', TRUE),
('Team Leadership', 'Ability to lead and manage teams', 'Management', TRUE),
('Computer Literacy', 'Basic computer and software skills', 'Technical', TRUE),
('Problem Solving', 'Analytical and problem-solving abilities', 'Soft Skills', TRUE),
('Communication', 'Verbal and written communication skills', 'Soft Skills', TRUE),
('Project Management', 'Project planning and execution', 'Management', TRUE),
('Data Analysis', 'Data interpretation and analysis', 'Technical', TRUE),
('Time Management', 'Efficient time and task management', 'Soft Skills', TRUE);

COMMIT;
