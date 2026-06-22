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
    -- Note: there is no separate `employees` table; employee fields live here.
    -- chk_hourly_rate is therefore placed on users instead of employees.
    hourly_rate DECIMAL(10, 2) DEFAULT 0,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP NULL,
    totp_secret VARCHAR(64) NULL,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    totp_recovery_codes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_hourly_rate CHECK (hourly_rate >= 0),

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
    INDEX idx_user_roles_user_expires (user_id, expires_at),
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

    CONSTRAINT chk_template_staff CHECK (max_staff >= min_staff AND min_staff >= 0),

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

    CONSTRAINT chk_shift_staff CHECK (max_staff >= min_staff AND min_staff >= 0),

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
    INDEX idx_assignment_user_status (user_id, status),

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

    CONSTRAINT chk_on_call_staff CHECK (max_staff >= min_staff AND min_staff >= 0),

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
    
    UNIQUE KEY unique_user_unavailability_period (user_id, start_date, end_date),
    INDEX idx_user (user_id),

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
    token_hash CHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex digest of the raw bearer token
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
-- MODULES TABLE - Runtime feature flags
-- Each module has a unique code; is_enabled is the runtime flag that
-- the requireModule(code) middleware checks. Changes persist across
-- restarts because they live in the DB, not in environment variables.
-- ================================================================
CREATE TABLE IF NOT EXISTS modules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_code (code)
);

-- Per-organization module overrides.  Rows here take priority over the global
-- is_enabled value in the modules table.  If no row exists for an org+code
-- pair the global default applies.
CREATE TABLE IF NOT EXISTS organization_module_overrides (
    id INT PRIMARY KEY AUTO_INCREMENT,
    organization_name VARCHAR(120) NOT NULL,
    module_code VARCHAR(60) NOT NULL,
    is_enabled BOOLEAN NOT NULL,
    updated_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_module (organization_name, module_code),
    FOREIGN KEY (module_code) REFERENCES modules(code) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- AUDIT LOGS TABLE - Track system activities
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    -- When the action was performed on behalf of another user (proxy / approval).
    on_behalf_of_user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    description TEXT,
    -- Optional free-text reason supplied by the actor at the time of the action.
    justification TEXT NULL,
    -- JSON snapshots of the entity state before and after a mutation.
    -- Populated for sensitive changes: role grants, policy edits, user updates.
    before_snapshot JSON NULL,
    after_snapshot JSON NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    -- Correlation ID from the X-Request-Id header; links the log entry back to
    -- the HTTP request that triggered it.
    request_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user (user_id),
    INDEX idx_on_behalf_of (on_behalf_of_user_id),
    INDEX idx_action (action),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_created (created_at),
    INDEX idx_request_id (request_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (on_behalf_of_user_id) REFERENCES users(id) ON DELETE SET NULL
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
    INDEX idx_user_org_primary (user_id, is_primary),

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
    INDEX idx_policies_imposed_by (imposed_by_user_id),

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
    INDEX idx_approval_matrix_approver_role (approver_role_id),

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
        'company_user',
        'responsibility_rule'
    ) NOT NULL,
    approver_role_id INT NULL,
    approver_user_id INT NULL,
    -- used when approver_scope = 'responsibility_rule'; identifies which permission to look up
    approver_permission_code VARCHAR(80) NULL,
    auto_approve_for_owner BOOLEAN NOT NULL DEFAULT TRUE,
    escalate_after_hours INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_workflow_order (workflow_id, step_order),
    INDEX idx_workflow (workflow_id),
    INDEX idx_approval_steps_approver (approver_role_id, approver_user_id),

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
('role.manage',           'role',            'manage',  'Create roles and assign permissions to them'),
('responsibility.read',  'responsibility',  'read',    'View responsibility rules'),
('responsibility.manage','responsibility',  'manage',  'Create, update and delete responsibility rules'),
('change_request.create','change_request','create',   'Propose a change request'),
('change_request.review','change_request','review',   'Approve, reject or apply change requests');

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
  'report.read','audit.read','user.read','user.manage',
  'responsibility.read','responsibility.manage',
  'change_request.create','change_request.review'
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

-- Default modules (all enabled by default)
INSERT IGNORE INTO modules (code, name, description, is_enabled) VALUES
('scheduling',    'Scheduling',     'Shift scheduling, optimizer, and calendar views', TRUE),
('approvals',     'Approvals',      'Approval workflows for time-off, loans, and policy exceptions', TRUE),
('notifications', 'Notifications',  'In-app and SSE notification delivery', TRUE),
('reporting',     'Reporting',      'Reports, analytics dashboards, and data exports', TRUE),
('analytics',     'Analytics',      'Advanced workforce analytics and KPIs', TRUE),
('forecasting',   'Forecasting',    'Demand forecasting and headcount planning', TRUE),
('integrations',  'Integrations',   'Third-party HR and payroll integrations', TRUE),
('audit',         'Audit Log',      'Audit trail viewer for administrators', TRUE),
('compliance',    'Compliance',     'Compliance rules, policy engine, and exception tracking', TRUE);

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
-- RESPONSIBILITY RULES
-- Multidimensional table that maps (subject group, permission) →
-- (responsible org unit). Answers the question:
--   "For users matching this condition, who is responsible for this
--    permission/capability?"
--
-- subject_type / subject_id:
--   'org_unit'   + id → all users whose primary org unit is that unit
--   'department' + id → all users in that department
--   'role'       + id → all users holding that role
--   'all'        + NULL → every user in the system
--
-- responsible_org_unit_id: the org unit that holds authority.
-- delegated_to_role_id: when set, only members of the org unit who also
--   hold this role can exercise the authority (NULL = all members).
-- ================================================================
CREATE TABLE IF NOT EXISTS responsibility_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subject_type ENUM('org_unit', 'department', 'role', 'all') NOT NULL,
    subject_id INT NULL,
    permission_code VARCHAR(80) NOT NULL,
    responsible_org_unit_id INT NOT NULL,
    delegated_to_role_id INT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_subject (subject_type, subject_id),
    INDEX idx_permission (permission_code),
    INDEX idx_responsible (responsible_org_unit_id),
    INDEX idx_active (is_active),

    FOREIGN KEY (responsible_org_unit_id) REFERENCES org_units(id) ON DELETE CASCADE,
    FOREIGN KEY (delegated_to_role_id) REFERENCES roles(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ================================================================
-- CHANGE REQUESTS
-- A subordinate proposes a change; when approved and applied the audit
-- log attributes the action to the authority holder (on_behalf_of tracks
-- the original proposer so the full chain is auditable).
-- ================================================================
CREATE TABLE IF NOT EXISTS change_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    change_type VARCHAR(80) NOT NULL,
    proposer_user_id INT NOT NULL,
    target_entity_type VARCHAR(60) NOT NULL,
    target_entity_id INT NULL,
    proposed_payload JSON NOT NULL,
    justification TEXT NULL,
    status ENUM('pending','approved','rejected','applied','cancelled') NOT NULL DEFAULT 'pending',
    approver_user_id INT NULL,
    approved_at TIMESTAMP NULL,
    rejected_at TIMESTAMP NULL,
    rejection_reason TEXT NULL,
    applied_at TIMESTAMP NULL,
    -- when applied, the action is attributed to this user (the authority holder)
    on_behalf_of_user_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_cr_proposer (proposer_user_id),
    INDEX idx_cr_status (status),
    INDEX idx_cr_change_type (change_type),
    INDEX idx_cr_target (target_entity_type, target_entity_id),
    INDEX idx_cr_approver (approver_user_id),

    FOREIGN KEY (proposer_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (on_behalf_of_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pending_approvals (
    id INT PRIMARY KEY AUTO_INCREMENT,
    change_request_id INT NOT NULL,
    workflow_id INT NOT NULL,
    step_id INT NOT NULL,
    step_order INT NOT NULL,
    assigned_to_user_id INT NOT NULL,
    status ENUM('pending','approved','rejected','escalated','skipped') NOT NULL DEFAULT 'pending',
    decided_at TIMESTAMP NULL,
    decision_note TEXT NULL,
    escalated_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id),
    FOREIGN KEY (step_id) REFERENCES approval_steps(id),
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_pending_approvals_assigned (assigned_to_user_id, status),
    INDEX idx_pending_approvals_cr (change_request_id, step_order)
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

-- Composite indexes for auth hot paths and assignment queries are defined
-- inline inside their respective CREATE TABLE IF NOT EXISTS statements above:
--   user_roles:        idx_user_roles_user_expires  (user_id, expires_at)
--   user_org_units:    idx_user_org_primary         (user_id, is_primary)
--   shift_assignments: idx_assignment_user_status   (user_id, status)

-- Additional composite indexes for common query patterns
-- Note: MySQL does not support CREATE INDEX IF NOT EXISTS as a standalone statement;
-- these run once on a fresh schema (init.sql is never applied to an existing DB).
-- shift_assignments has shift_id (not schedule_id); route joins via shifts.schedule_id.
CREATE INDEX idx_shift_assignments_shift_status ON shift_assignments(shift_id, status);
CREATE INDEX idx_time_off_requests_user_dates ON time_off_requests(user_id, start_date, end_date);
CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at);
CREATE INDEX idx_cr_created_status ON change_requests(created_at DESC, status);
CREATE INDEX idx_responsibility_subject_perm ON responsibility_rules(subject_type, subject_id, permission_code, is_active);
