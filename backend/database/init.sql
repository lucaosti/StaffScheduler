-- ================================================================
-- Staff Scheduler Database Schema
-- Simplified and optimized schema - keeping only essential features
-- Inspired by PoliTO_Timetable_Allocator architecture
-- ================================================================

-- ================================================================
-- USERS TABLE - Authentication and basic user info
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('admin', 'manager', 'employee') NOT NULL DEFAULT 'employee',
    employee_id VARCHAR(50) UNIQUE,
    position VARCHAR(100),
    hourly_rate DECIMAL(10, 2) DEFAULT 0,
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
-- DEPARTMENTS TABLE - Organizational structure
-- ================================================================
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    manager_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_manager (manager_id),
    INDEX idx_active (is_active),
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- USER DEPARTMENTS JUNCTION TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS user_departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_department (user_id, department_id),
    INDEX idx_user (user_id),
    INDEX idx_department (department_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ================================================================
-- SKILLS TABLE - Available skills/competencies  
-- ================================================================
CREATE TABLE IF NOT EXISTS skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_active (is_active)
);

-- ================================================================
-- USER SKILLS JUNCTION TABLE
-- ================================================================
CREATE TABLE IF NOT EXISTS user_skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    skill_id INT NOT NULL,
    
    UNIQUE KEY unique_user_skill (user_id, skill_id),
    INDEX idx_user (user_id),
    INDEX idx_skill (skill_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ================================================================
-- SHIFT TEMPLATES TABLE - Reusable shift definitions
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    department_id INT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    min_staff INT DEFAULT 1,
    max_staff INT DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_department (department_id),
    INDEX idx_active (is_active),
    
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ================================================================
-- SHIFT TEMPLATE SKILLS - Required skills for shift templates
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_template_skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    template_id INT NOT NULL,
    skill_id INT NOT NULL,
    
    UNIQUE KEY unique_template_skill (template_id, skill_id),
    INDEX idx_template (template_id),
    INDEX idx_skill (skill_id),
    
    FOREIGN KEY (template_id) REFERENCES shift_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
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
-- SHIFTS TABLE - Individual shift instances
-- ================================================================
CREATE TABLE IF NOT EXISTS shifts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NOT NULL,
    department_id INT NOT NULL,
    template_id INT NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    min_staff INT DEFAULT 1,
    max_staff INT DEFAULT 10,
    notes TEXT,
    status ENUM('open', 'assigned', 'confirmed', 'cancelled') DEFAULT 'open',
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
-- SHIFT SKILLS - Required skills for specific shifts
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    shift_id INT NOT NULL,
    skill_id INT NOT NULL,
    
    UNIQUE KEY unique_shift_skill (shift_id, skill_id),
    INDEX idx_shift (shift_id),
    INDEX idx_skill (skill_id),
    
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- ================================================================
-- SHIFT ASSIGNMENTS TABLE - Employee assignments to shifts
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    shift_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('pending', 'confirmed', 'cancelled') DEFAULT 'pending',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP NULL,
    notes TEXT,
    
    UNIQUE KEY unique_shift_user (shift_id, user_id),
    INDEX idx_shift (shift_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- USER UNAVAILABILITY TABLE - When employees cannot work
-- Similar to Teachers_Unavailability in PoliTO
-- ================================================================
CREATE TABLE IF NOT EXISTS user_unavailability (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_dates (start_date, end_date),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- USER PREFERENCES TABLE - Employee scheduling preferences
-- Inspired by PoliTO's teacher preferences
-- ================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    max_hours_per_week INT DEFAULT 40,
    min_hours_per_week INT DEFAULT 0,
    max_consecutive_days INT DEFAULT 5,
    preferred_shifts JSON,  -- array of shift template IDs
    avoid_shifts JSON,      -- array of shift template IDs
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_pref (user_id),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- SYSTEM SETTINGS TABLE - Application-wide configuration
-- ================================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(50) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    value TEXT,
    type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    default_value TEXT,
    description TEXT,
    is_editable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_category_key (category, `key`),
    INDEX idx_category (category)
);

-- ================================================================
-- AUDIT LOGS TABLE - Track system activities
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    description TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_action (action),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_created (created_at),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- DEFAULT DATA INSERTION
-- Minimal essential data - users and departments will be created by init-database.ts
-- ================================================================

-- Default skills
INSERT IGNORE INTO skills (name, description, is_active) VALUES
('General Staff', 'General staff member with basic skills', TRUE),
('Customer Service', 'Customer interaction and support', TRUE),
('Team Leadership', 'Ability to lead teams', TRUE),
('Technical Skills', 'Technical and computer skills', TRUE);

-- Default system settings
INSERT IGNORE INTO system_settings (category, `key`, value, type, default_value, description, is_editable) VALUES
('general', 'currency', 'EUR', 'string', 'EUR', 'Default currency for the application (EUR or USD)', TRUE),
('general', 'time_period', 'monthly', 'string', 'monthly', 'Default time period for scheduling (monthly, weekly, daily)', TRUE),
('scheduling', 'max_shifts_per_week', '5', 'number', '5', 'Maximum number of shifts an employee can work per week', TRUE),
('scheduling', 'min_hours_between_shifts', '8', 'number', '8', 'Minimum hours required between shifts for the same employee', TRUE);

-- ================================================================
-- END OF SCHEMA
-- ================================================================
