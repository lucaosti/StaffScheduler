-- Per-organization rules about employee fields: required, visible, editable.
--
-- WHY THE GOVERNABLE FIELDS ARE AN ALLOWLIST IN CODE, NOT ANY COLUMN NAME. This
-- table names fields, and a table that could name any column would let a
-- CONFIGURATION CHANGE — not a deploy, not a review — make `password_hash` a
-- visible directory field or `totp_secret` editable. The set of core fields a
-- policy may govern is therefore fixed in application code
-- (`services/employeeFieldPolicy`), and `field_key` is validated against it on
-- write. Custom keys are open by construction, since `user_custom_fields`
-- already holds arbitrary key/value data an administrator entered.
--
-- WHY VISIBILITY AND EDITABILITY ARE PERMISSION CODES AND NOT ROLE IDS. Roles
-- are configurable data: renaming or deleting one would silently break every
-- policy naming it, and the failure would be a field quietly becoming visible or
-- uneditable with nothing pointing at the cause. Permission codes are stable and
-- are how every other authorization decision in this system is expressed. A
-- role-based rule is still expressible — grant the code to the role.
--
-- WHY NULL MEANS "NO RESTRICTION" RATHER THAN "NOBODY". A policy row usually
-- exists to say ONE thing about a field — that it is required, say — and forcing
-- whoever writes it to also name a visibility code would make the common case
-- the dangerous one, because the natural placeholder to type is a code that
-- almost nobody holds. Absent means unchanged from the system default.
--
-- WHY THE VALIDATION VOCABULARY IS CLOSED. `min_length`, `max_length`,
-- `min_value`, `max_value`, `pattern`, `allowed_values` — and nothing else. An
-- arbitrary-expression evaluator reading from a configuration table is a
-- code-execution surface, and being administrator-writable does not make it less
-- of one. `pattern` is the one entry that still carries risk (a user-supplied
-- regex is a ReDoS surface), so its length is capped here and it only ever runs
-- against input the Zod schema has already bounded.
--
-- WHY `organization_name` RATHER THAN AN ORG-UNIT ID. It matches how module
-- overrides already scope per organization (`organization_module_overrides`),
-- and a field policy is an organization-wide statement about what an employee
-- record must contain — not something a single ward decides for itself.

-- migrate:up

CREATE TABLE IF NOT EXISTS employee_field_policies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    -- NULL applies to every organization; a named row overrides it. Same
    -- resolution order module overrides use.
    organization_name VARCHAR(120) NULL,
    -- A core field name (validated against the allowlist in code) or
    -- `custom:<key>` for a user_custom_fields entry.
    field_key VARCHAR(80) NOT NULL,

    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    -- Permission needed to SEE the value. NULL = no restriction.
    visible_permission VARCHAR(64) NULL,
    -- Permission needed to CHANGE it. NULL = no restriction beyond the
    -- endpoint's own gate.
    edit_permission VARCHAR(64) NULL,

    min_length INT NULL,
    max_length INT NULL,
    min_value DECIMAL(12, 2) NULL,
    max_value DECIMAL(12, 2) NULL,
    -- Capped length: a user-supplied regex is a ReDoS surface, and a short one
    -- is far harder to make pathological.
    pattern VARCHAR(200) NULL,
    -- JSON array of permitted values, for closed vocabularies like `position`.
    allowed_values JSON NULL,
    -- Shown to whoever fills the field in when the rule refuses their value;
    -- "must match ^[A-Z]{2}\\d{4}$" is not something to put in front of a person.
    help_text VARCHAR(255) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- One row per field per organization. The generated column makes the
    -- constraint hold for the global row too: NULL never equals NULL in a
    -- UNIQUE key, so without it an organization could accumulate several
    -- conflicting global policies for one field and the resolution order would
    -- silently depend on insertion order.
    org_key VARCHAR(120) AS (COALESCE(organization_name, '')) STORED,
    UNIQUE KEY unique_org_field (org_key, field_key),
    INDEX idx_org (organization_name)
);

-- migrate:down

DROP TABLE IF EXISTS employee_field_policies;
