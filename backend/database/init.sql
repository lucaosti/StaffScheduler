-- ================================================================
-- Staff Scheduler Database Schema
-- Simplified and optimized schema - keeping only essential features
-- Inspired by PoliTO_Timetable_Allocator architecture
-- ================================================================

-- ================================================================
-- TENANTS TABLE (F13) - Multi-tenant scaffolding
-- All tenant-scoped tables should carry a tenant_id FK to this row.
-- The default tenant (id=1) seeds a single-tenant deployment.
-- ================================================================
CREATE TABLE IF NOT EXISTS tenants (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_active (is_active)
);

INSERT IGNORE INTO tenants (id, name, slug, is_active) VALUES (1, 'Default', 'default', TRUE);

-- ================================================================
-- USERS TABLE - Authentication and basic user info
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    employee_id VARCHAR(50) UNIQUE,
    position VARCHAR(100),
    hourly_rate DECIMAL(10, 2) DEFAULT 0,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    totp_secret VARCHAR(64) NULL,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    totp_recovery_codes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_email (email),
    INDEX idx_employee_id (employee_id),
    INDEX idx_active (is_active)
);

-- ================================================================
-- RBAC: Configurable roles and permissions (no hardcoded roles)
-- ----------------------------------------------------------------
-- Authorization is permission-based. Application code references only
-- permission CODES; roles are editable DATA that group permissions, so an
-- organization can define any role at any level of its hierarchy.
--   permissions       - the fixed catalog of capability codes the code checks
--   roles             - configurable named bundles of permissions (data)
--   role_permissions  - which permissions each role grants (M:N)
--   user_roles        - role grants to users, optionally scoped to an org_unit
--                       subtree and optionally time-bound (expires_at)
-- `roles.is_system` only protects the bootstrap super-admin from deletion;
-- every other role is fully editable and removable.
-- ================================================================
CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(80) NOT NULL UNIQUE,
    resource VARCHAR(60) NOT NULL,
    action VARCHAR(40) NOT NULL,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_resource (resource)
);

CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_system (is_system)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (role_id, permission_id),
    INDEX idx_role (role_id),
    INDEX idx_permission (permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    scope_org_unit_id INT NULL,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_user_role_scope (user_id, role_id, scope_org_unit_id),
    INDEX idx_user (user_id),
    INDEX idx_role (role_id),
    INDEX idx_scope (scope_org_unit_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    -- scope_org_unit_id intentionally has no FK: org_units is created later in
    -- this script and scope integrity is enforced at the application layer.
);

-- ================================================================
-- DEPARTMENTS TABLE - Organizational structure
-- ================================================================
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    manager_id INT NULL,
    -- Links this department to the org-unit tree for hierarchical access scoping.
    -- FK added below (after org_units is defined) via ALTER TABLE.
    org_unit_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_manager (manager_id),
    INDEX idx_org_unit (org_unit_id),
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
    proficiency_level TINYINT DEFAULT 1 CHECK (proficiency_level BETWEEN 1 AND 5),

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
    department_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
    created_by INT NULL,
    published_by INT NULL,
    published_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_dates (start_date, end_date),
    INDEX idx_status (status),
    INDEX idx_created_by (created_by),
    INDEX idx_department (department_id),
    
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
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
    INDEX idx_schedule_date (schedule_id, date),
    INDEX idx_department (department_id),
    INDEX idx_date (date),
    INDEX idx_status (status),
    INDEX idx_template (template_id),

    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (template_id) REFERENCES shift_templates(id) ON DELETE SET NULL
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
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INT NULL,
    confirmed_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_shift_user (shift_id, user_id),
    INDEX idx_shift (shift_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- ON-CALL PERIODS TABLE - "Reperibilità": be available on short notice
-- Modelled alongside shifts so a regular shift means active duty and an
-- on-call period means standby. Compliance treats on-call hours at half
-- weight by default (configurable in system_settings).
-- ================================================================
CREATE TABLE IF NOT EXISTS on_call_periods (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NULL,
    department_id INT NOT NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    min_staff INT NOT NULL DEFAULT 1,
    max_staff INT NOT NULL DEFAULT 2,
    notes TEXT,
    status ENUM('open', 'assigned', 'cancelled') NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_schedule (schedule_id),
    INDEX idx_department_date (department_id, date),
    INDEX idx_status (status),

    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ================================================================
-- ON-CALL ASSIGNMENTS TABLE - Users on-call for a given period
-- ================================================================
CREATE TABLE IF NOT EXISTS on_call_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    period_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by INT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_period_user (period_id, user_id),
    INDEX idx_period (period_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),

    FOREIGN KEY (period_id) REFERENCES on_call_periods(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- USER CUSTOM FIELDS TABLE - Configurable per-tenant profile fields
-- Free-form key/value rows so admins can extend the directory without
-- changing the schema. is_public controls whether the field appears in
-- exported vCards and the directory listing.
-- ================================================================
CREATE TABLE IF NOT EXISTS user_custom_fields (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    field_value TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_user_key (user_id, field_key),
    INDEX idx_user (user_id),

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
    INDEX idx_user_dates (user_id, start_date, end_date),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- NOTIFICATIONS TABLE - In-app inbox; email delivery is handled in-process
-- ================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link VARCHAR(500),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL,

    INDEX idx_user (user_id),
    INDEX idx_user_unread (user_id, is_read),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- USER CALENDAR TOKENS TABLE - Per-user opaque tokens for iCal feeds
-- The .ics URL is shared with calendar apps that cannot send Authorization
-- headers; rotating the token revokes every active subscription.
-- ================================================================
CREATE TABLE IF NOT EXISTS user_calendar_tokens (
    user_id INT PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- SHIFT SWAP REQUESTS TABLE - Employee-to-employee shift exchanges
-- Both legs of the swap are required; manager approves or declines.
-- ================================================================
CREATE TABLE IF NOT EXISTS shift_swap_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    requester_user_id INT NOT NULL,
    requester_assignment_id INT NOT NULL,
    target_user_id INT NOT NULL,
    target_assignment_id INT NOT NULL,
    status ENUM('pending', 'approved', 'declined', 'cancelled') NOT NULL DEFAULT 'pending',
    notes TEXT,
    reviewer_id INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_requester (requester_user_id),
    INDEX idx_target (target_user_id),
    INDEX idx_status (status),

    FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (target_assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- TIME OFF REQUESTS TABLE - Workflow for vacation/sick/personal leave
-- An approved request materializes into a row in user_unavailability.
-- ================================================================
CREATE TABLE IF NOT EXISTS time_off_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    type ENUM('vacation', 'sick', 'personal', 'other') NOT NULL DEFAULT 'vacation',
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    reviewer_id INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT,
    unavailability_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_user_dates (user_id, start_date, end_date),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (unavailability_id) REFERENCES user_unavailability(id) ON DELETE SET NULL
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
-- ORG UNITS TABLE - Hierarchical organizational tree
-- Each unit has an optional parent (self-FK) and an optional manager.
-- The tree is the primary backbone for policy scoping and approvals.
-- ================================================================
CREATE TABLE IF NOT EXISTS org_units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    parent_id INT NULL,
    manager_user_id INT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_parent (parent_id),
    INDEX idx_manager (manager_user_id),
    INDEX idx_active (is_active),

    FOREIGN KEY (parent_id) REFERENCES org_units(id) ON DELETE SET NULL,
    FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- USER ORG UNITS - Membership of users in the tree
-- A user may belong to multiple units; exactly one row should be flagged
-- `is_primary = TRUE` (enforced at app level).
-- ================================================================
CREATE TABLE IF NOT EXISTS user_org_units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    org_unit_id INT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_user_org_unit (user_id, org_unit_id),
    INDEX idx_user (user_id),
    INDEX idx_org_unit (org_unit_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_unit_id) REFERENCES org_units(id) ON DELETE CASCADE
);

-- ================================================================
-- EMPLOYEE LOANS - Time-bounded cross-unit assignments
-- Used when a manager borrows an employee from another org unit. Both the
-- source and target unit managers are notified; the configured approver
-- (per the approval matrix) accepts/declines.
-- ================================================================
CREATE TABLE IF NOT EXISTS employee_loans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    from_org_unit_id INT NOT NULL,
    to_org_unit_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected', 'cancelled', 'ended')
        NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    approver_user_id INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user (user_id),
    INDEX idx_from (from_org_unit_id),
    INDEX idx_to (to_org_unit_id),
    INDEX idx_status (status),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (from_org_unit_id) REFERENCES org_units(id) ON DELETE CASCADE,
    FOREIGN KEY (to_org_unit_id) REFERENCES org_units(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- POLICIES - Imposed rules. A policy carries an owner; exceptions to it
-- must be approved by that owner (or an escalation chain).
-- `policy_value` is JSON so we can encode arbitrary parameters per key.
-- ================================================================
CREATE TABLE IF NOT EXISTS policies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    scope_type ENUM('global', 'org_unit', 'schedule', 'shift_template')
        NOT NULL DEFAULT 'global',
    scope_id INT NULL,
    policy_key VARCHAR(80) NOT NULL,
    policy_value JSON,
    description TEXT,
    imposed_by_user_id INT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_scope (scope_type, scope_id),
    INDEX idx_active (is_active),
    INDEX idx_owner (imposed_by_user_id),

    FOREIGN KEY (imposed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- ================================================================
-- POLICY EXCEPTION REQUESTS - Per-target derogations to a policy
-- ================================================================
CREATE TABLE IF NOT EXISTS policy_exception_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    policy_id INT NOT NULL,
    target_type VARCHAR(60) NOT NULL,
    target_id INT NOT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected', 'cancelled')
        NOT NULL DEFAULT 'pending',
    requested_by_user_id INT NOT NULL,
    reviewer_user_id INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_policy (policy_id),
    INDEX idx_target (target_type, target_id),
    INDEX idx_status (status),
    INDEX idx_requested_by (requested_by_user_id),

    FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- APPROVAL MATRIX - Configurable approver scope per change type
-- `change_type` is a free-form key (for example `Loan.Request`,
-- `Policy.Update`, `Schedule.Publish`). `approver_scope` controls how the
-- approver is resolved at runtime:
--   - `policy_owner`        - owner of the policy at hand
--   - `unit_manager`        - manager of the involved org_unit
--   - `unit_manager_chain`  - escalate up the org tree until a manager is found
--   - `company_role`        - any user holding the role stored in `approver_role_id`
--   - `company_user`        - the specific user stored in `approver_user_id`
-- The `auto_approve_for_owner` flag controls "if actor is the resolved
-- approver, auto-approve and write an audit log row".
-- ================================================================
CREATE TABLE IF NOT EXISTS approval_matrix (
    id INT PRIMARY KEY AUTO_INCREMENT,
    change_type VARCHAR(80) NOT NULL,
    approver_scope ENUM(
        'policy_owner',
        'unit_manager',
        'unit_manager_chain',
        'company_role',
        'company_user'
    ) NOT NULL,
    approver_role_id INT NULL,
    approver_user_id INT NULL,
    auto_approve_for_owner BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_change_type (change_type),

    FOREIGN KEY (approver_role_id) REFERENCES roles(id) ON DELETE SET NULL,
    FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- APPROVAL WORKFLOWS — multi-step, configurable approval chains
--
-- This replaces the single-step `approval_matrix` with an ordered list of
-- steps. Each `approval_workflows` row corresponds to exactly one
-- `change_type`; each `approval_steps` row is one step in that chain.
--
-- `require_all` = TRUE  → every step must approve before the request advances.
-- `require_all` = FALSE → first step to approve is sufficient.
-- `escalate_after_hours` → if non-null, a background job advances the
--                          request to the next step after the timeout.
-- ================================================================
CREATE TABLE IF NOT EXISTS approval_workflows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    change_type VARCHAR(80) NOT NULL,
    require_all BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_change_type (change_type)
);

CREATE TABLE IF NOT EXISTS approval_steps (
    id INT PRIMARY KEY AUTO_INCREMENT,
    workflow_id INT NOT NULL,
    step_order TINYINT NOT NULL,
    approver_scope ENUM(
        'policy_owner',
        'unit_manager',
        'unit_manager_chain',
        'company_role',
        'company_user'
    ) NOT NULL,
    approver_role_id INT NULL,
    approver_user_id INT NULL,
    auto_approve_for_owner BOOLEAN NOT NULL DEFAULT TRUE,
    escalate_after_hours INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_workflow_order (workflow_id, step_order),
    INDEX idx_workflow (workflow_id),

    FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id) ON DELETE CASCADE,
    FOREIGN KEY (approver_role_id) REFERENCES roles(id) ON DELETE SET NULL,
    FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- DEFAULT DATA INSERTION
-- Minimal essential data - users and departments will be created by init-database.ts
-- ================================================================

-- ----------------------------------------------------------------
-- RBAC catalog: permission codes (referenced by name in application code)
-- ----------------------------------------------------------------
INSERT IGNORE INTO permissions (code, resource, action, description) VALUES
('employee.read',     'employee',  'read',    'View staff / employee records'),
('employee.manage',   'employee',  'manage',  'Create, update and delete staff records and their skills'),
('schedule.read',     'schedule',  'read',    'View schedules'),
('schedule.manage',   'schedule',  'manage',  'Create, update, delete, duplicate and archive schedules'),
('schedule.publish',  'schedule',  'publish', 'Publish schedules'),
('schedule.optimize', 'schedule',  'optimize','Run the optimizer / auto-generate schedules'),
('assignment.manage', 'assignment','manage',  'Create, update and delete shift assignments'),
('shift.manage',      'shift',     'manage',  'Manage shift templates and shifts'),
('department.read',   'department','read',    'View departments'),
('department.manage', 'department','manage',  'Create, update and delete departments'),
('org_unit.read',     'org_unit',  'read',    'View the organization tree'),
('org_unit.manage',   'org_unit',  'manage',  'Create, update and delete organization units'),
('oncall.manage',     'oncall',    'manage',  'Manage on-call periods and assignments'),
('policy.read',       'policy',    'read',    'View policies'),
('policy.manage',     'policy',    'manage',  'Create, update and delete policies'),
('policy.approve',    'policy',    'approve', 'Approve or reject policy exception requests'),
('approval.manage',   'approval',  'manage',  'Configure the approval matrix / workflows'),
('loan.request',      'loan',      'request', 'Create employee loan requests'),
('loan.approve',      'loan',      'approve', 'Approve or reject employee loan requests'),
('timeoff.approve',   'timeoff',   'approve', 'Approve or reject time-off requests'),
('shiftswap.approve', 'shiftswap', 'approve', 'Approve or decline shift-swap requests'),
('preferences.manage','preferences','manage', 'View and edit other users'' preferences'),
('report.read',       'report',    'read',    'View reports and analytics'),
('audit.read',        'audit',     'read',    'View audit logs'),
('user.read',         'user',      'read',    'View user accounts and the directory'),
('user.manage',       'user',      'manage',  'Create, update and delete user accounts and assign roles'),
('settings.manage',   'settings',  'manage',  'Edit system settings'),
('role.manage',       'role',      'manage',  'Create roles and assign permissions to them');

-- ----------------------------------------------------------------
-- Default roles (editable data; not hardcoded in application code).
-- Administrator is a protected system role; Manager and Employee are
-- ordinary, fully-editable starter roles.
-- ----------------------------------------------------------------
INSERT IGNORE INTO roles (name, description, is_system) VALUES
('Administrator', 'Full, unrestricted system access', TRUE),
('Manager',       'Manages staff, schedules and approvals', FALSE),
('Employee',      'Self-service access for scheduled staff', FALSE);

-- Administrator gets every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'Administrator';

-- Manager gets the day-to-day management subset (no system settings, role or
-- org-tree administration, which stay with Administrator).
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'employee.read','employee.manage','schedule.read','schedule.manage','schedule.publish',
  'schedule.optimize','assignment.manage','shift.manage','department.read','department.manage',
  'org_unit.read','oncall.manage','policy.read','policy.manage','policy.approve',
  'loan.request','loan.approve','timeoff.approve','shiftswap.approve','preferences.manage',
  'report.read','audit.read','user.read','user.manage'
) WHERE r.name = 'Manager';

-- Employee gets read-only visibility; self-service actions (creating own
-- time-off / swap / loan requests) require only authentication, not a permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'schedule.read','department.read','org_unit.read','policy.read','employee.read'
) WHERE r.name = 'Employee';

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

-- Default approval matrix (legacy single-step rows — kept for backward compat)
INSERT IGNORE INTO approval_matrix (change_type, approver_scope, approver_role_id, auto_approve_for_owner, description) VALUES
('Loan.Request',          'unit_manager',       NULL, TRUE, 'Cross-department employee loans approved by the receiving unit manager'),
('Loan.Cancel',           'unit_manager',       NULL, TRUE, 'Cancellation of an approved loan requires receiving unit manager approval'),
('Policy.Create',         'company_role',       (SELECT id FROM roles WHERE name = 'Administrator'), TRUE, 'New policy creation goes through an administrator'),
('Policy.Update',         'policy_owner',       NULL, TRUE, 'Edits to a policy require approval by the policy owner'),
('Policy.Exception',      'policy_owner',       NULL, TRUE, 'Derogations to a policy require approval by its owner'),
('Schedule.Publish',      'unit_manager',       NULL, TRUE, 'Publishing a schedule requires the receiving unit manager'),
('Schedule.Override',     'unit_manager_chain', NULL, TRUE, 'Schedule overrides escalate up the org tree if needed'),
('OrgUnit.Update',        'company_role',       (SELECT id FROM roles WHERE name = 'Administrator'), TRUE, 'Org tree edits go through an administrator'),
('Membership.Update',     'unit_manager',       NULL, TRUE, 'User membership changes need the unit manager');

-- ----------------------------------------------------------------
-- Default approval workflows (multi-step engine)
-- Mirrors the approval_matrix rows above as single-step workflows,
-- plus TimeOff.Request and ShiftSwap.Request which were hardcoded.
-- ----------------------------------------------------------------
INSERT IGNORE INTO approval_workflows (change_type, require_all, description) VALUES
('Loan.Request',      FALSE, 'Loan request — unit manager approval'),
('Loan.Cancel',       FALSE, 'Loan cancellation — unit manager approval'),
('Policy.Create',     FALSE, 'Policy creation — administrator approval'),
('Policy.Update',     FALSE, 'Policy update — policy owner approval'),
('Policy.Exception',  FALSE, 'Policy exception — policy owner approval'),
('Schedule.Publish',  FALSE, 'Schedule publish — unit manager approval'),
('Schedule.Override', FALSE, 'Schedule override — escalates up the org tree'),
('OrgUnit.Update',    FALSE, 'Org tree edit — administrator approval'),
('Membership.Update', FALSE, 'Membership change — unit manager approval'),
('TimeOff.Request',   FALSE, 'Time-off request — unit manager approval'),
('ShiftSwap.Request', FALSE, 'Shift swap — unit manager approval');

-- Steps for each workflow (one step = same behavior as the old single-row matrix)
INSERT IGNORE INTO approval_steps (workflow_id, step_order, approver_scope, approver_role_id, auto_approve_for_owner, escalate_after_hours)
SELECT w.id, 1, 'unit_manager', NULL, TRUE, 48
FROM approval_workflows w WHERE w.change_type IN ('Loan.Request','Loan.Cancel','Schedule.Publish','Membership.Update','TimeOff.Request','ShiftSwap.Request');

INSERT IGNORE INTO approval_steps (workflow_id, step_order, approver_scope, approver_role_id, auto_approve_for_owner, escalate_after_hours)
SELECT w.id, 1, 'company_role', (SELECT id FROM roles WHERE name = 'Administrator'), TRUE, 72
FROM approval_workflows w WHERE w.change_type IN ('Policy.Create','OrgUnit.Update');

INSERT IGNORE INTO approval_steps (workflow_id, step_order, approver_scope, approver_role_id, auto_approve_for_owner, escalate_after_hours)
SELECT w.id, 1, 'policy_owner', NULL, TRUE, 48
FROM approval_workflows w WHERE w.change_type IN ('Policy.Update','Policy.Exception');

INSERT IGNORE INTO approval_steps (workflow_id, step_order, approver_scope, approver_role_id, auto_approve_for_owner, escalate_after_hours)
SELECT w.id, 1, 'unit_manager_chain', NULL, TRUE, NULL
FROM approval_workflows w WHERE w.change_type = 'Schedule.Override';

-- ================================================================
-- DELEGATIONS TABLE
-- Allows user A (delegator) to grant user B (delegatee) a subset of their
-- own permissions for a bounded time window. Rules enforced by the app:
--   - permission_codes must be a subset of the delegator's own permissions
--   - chained sub-delegation is not allowed
--   - a delegation that has passed expires_at is ignored by getEffectivePermissions
-- ================================================================
CREATE TABLE IF NOT EXISTS delegations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    delegator_id INT NOT NULL,
    delegatee_id INT NOT NULL,
    permission_codes JSON NOT NULL,
    scope_org_unit_id INT NULL,
    starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_delegatee (delegatee_id),
    INDEX idx_delegator (delegator_id),
    INDEX idx_active_expiry (is_active, expires_at),

    FOREIGN KEY (delegator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (delegatee_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ================================================================
-- DEFERRED FOREIGN KEYS
-- Added here because they reference tables defined later than the source table.
-- ================================================================

-- departments.org_unit_id → org_units (org_units is defined after departments)
ALTER TABLE departments
    ADD CONSTRAINT fk_departments_org_unit
    FOREIGN KEY (org_unit_id) REFERENCES org_units(id) ON DELETE SET NULL;

-- ================================================================
-- END OF SCHEMA
-- ================================================================
