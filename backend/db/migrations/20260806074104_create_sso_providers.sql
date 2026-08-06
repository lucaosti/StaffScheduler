-- SSO federation: per-organization identity-provider configuration, and the
-- federated-identity link table it JIT-provisions or matches against.
--
-- WHY A DB TABLE AND NOT ENV VARS. Email/push/SMS/Gusto are all "one account,
-- one deployment" integrations — a single set of credentials in `.env` is the
-- right shape. An identity provider is different: every organization on this
-- deployment has its OWN IdP (their own Google Workspace, their own Okta
-- tenant), so the configuration is per-tenant data an administrator sets
-- through the API, not a deployment-wide secret an operator sets once.
-- `organization_name` reuses the same soft-multi-tenant tag `webhook_subscriptions`
-- already scopes by — a NULL row is available to any organization, a named
-- one only to its own.
--
-- WHY OIDC ONLY, NO SAML COLUMNS YET. OIDC was decided as the first protocol:
-- JSON/REST, verifiable with a JWKS fetch and a JWT library already in this
-- codebase, versus SAML's XML-signature ceremony. SAML support is a second
-- provider through the same `sso_providers` shape later, not a redesign of it.
--
-- WHY THE CLIENT SECRET IS PLAINTEXT. Same reasoning `webhook_subscriptions`
-- already documents for its own secret: the token exchange needs to SEND the
-- raw secret to the identity provider (as `client_secret` in the token
-- request body), not verify a one-way hash of it — there is no operation
-- this value is used for other than presenting it back.
--
-- WHY JIT PROVISIONING DEFAULTS OFF. Auto-creating an account for anyone the
-- IdP successfully authenticates is a real access-control decision an
-- administrator has to opt into per provider, not a default this migration
-- should make for them — the safe default is "known accounts only" until
-- someone turns it on and picks the role newly-created accounts land in.

-- migrate:up

CREATE TABLE IF NOT EXISTS sso_providers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    organization_name VARCHAR(255) NULL,
    name VARCHAR(120) NOT NULL,
    issuer VARCHAR(255) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    authorization_url VARCHAR(500) NOT NULL,
    token_url VARCHAR(500) NOT NULL,
    jwks_url VARCHAR(500) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    jit_provisioning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_role_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_sso_providers_org (organization_name),
    INDEX idx_sso_providers_active (is_active),

    FOREIGN KEY (default_role_id) REFERENCES roles(id) ON DELETE SET NULL
);

-- One row per (provider, IdP-subject) pair, linking it to the local account
-- it resolves to. `subject_id` is the OIDC `sub` claim — the one identifier
-- an IdP guarantees is stable and unique per user, unlike email, which can be
-- reassigned or changed at the IdP.
CREATE TABLE IF NOT EXISTS sso_identities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    provider_id INT NOT NULL,
    subject_id VARCHAR(255) NOT NULL,
    raw_profile JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_sso_identity_subject (provider_id, subject_id),
    INDEX idx_sso_identities_user (user_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES sso_providers(id) ON DELETE CASCADE
);

-- migrate:down

DROP TABLE IF EXISTS sso_identities;
DROP TABLE IF EXISTS sso_providers;
