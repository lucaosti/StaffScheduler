-- Per-organization translation overrides, layered on top of the shipped
-- i18n catalogs at runtime.
--
-- WHY A NEW TABLE AND NOT `system_settings`. `system_settings` has no
-- organization-scoping column — it is global. Per-organization overrides need
-- per-org scoping, so this follows the same pattern `sso_providers` already
-- established: a nullable `organization_name` column (NULL = platform-wide
-- default, a specific value = that organization only).
--
-- WHY THE WHOLE MAP IN ONE JSON COLUMN, NOT ONE ROW PER KEY. `overrides`
-- holds the entire `Record<string, string>` map for one organization+locale,
-- matching `applyOrganizationOverrides(locale, overrides)`'s existing
-- frontend signature exactly — that function already takes the whole map at
-- once, so storing it the same shape means the fetch is one row, not a
-- key-count-sized result set.
--
-- WHY THE GENERATED `org_key` COLUMN. NULL never equals NULL in a UNIQUE key,
-- so a bare UNIQUE(organization_name, locale) would let the platform-wide row
-- for one locale be inserted more than once — same problem
-- `employee_field_policies` solved the same way, and the same fix.

-- migrate:up

CREATE TABLE IF NOT EXISTS translation_overrides (
    id INT PRIMARY KEY AUTO_INCREMENT,
    organization_name VARCHAR(255) NULL,
    locale VARCHAR(10) NOT NULL,
    overrides JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    org_key VARCHAR(255) AS (COALESCE(organization_name, '')) STORED,
    UNIQUE KEY uq_translation_overrides_org_locale (org_key, locale),
    INDEX idx_translation_overrides_org (organization_name)
);

-- migrate:down
DROP TABLE IF EXISTS translation_overrides;
