-- Remove the multi-tenancy scaffolding.
--
-- The `tenants` table and the resolveTenant middleware were the entry point for
-- a multi-tenant story that was never completed: no other table ever gained a
-- `tenant_id` column and no service filtered by tenant, so the X-Tenant-Id
-- header validated against this table but isolated nothing. That is the worst
-- state — complexity and an implied contract with no actual isolation. This
-- deployment is single-tenant, so the scaffolding is removed rather than
-- completed (issue #294). The down path restores the table exactly as
-- initial_schema created it, so the decision is reversible.

-- migrate:up
DROP TABLE IF EXISTS tenants;

-- migrate:down
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
