-- Cost plans: a fixed labor-cost target per department per period, set by an
-- administrator.
--
-- WHY A MANAGER-ENTERED NUMBER AND NOT A DERIVED ESTIMATE. A derived figure
-- would need employment_contracts x contracted-hours x average hourly-rate
-- modeling with its own edge cases (part-time, mid-period joiners), for a
-- feature whose whole point is comparing REALITY against a MANAGER'S OWN
-- target. A manager-entered number is simpler, more honest about being a
-- target rather than a projection, and is what "budget" ordinarily means in
-- this domain.
--
-- WHY start_date/end_date DATE AND NOT A PERIOD KEY. `schedules` already
-- models a period this way (`start_date DATE NOT NULL, end_date DATE NOT
-- NULL`, indexed together) and reports read that same shape. Reusing it
-- means one period convention in the codebase, not two.
--
-- WHY DECIMAL(10, 2). Same precision `users.hourly_rate` already stores
-- currency in; the actual-cost figure this compares against is computed from
-- that column, so the two sides of the comparison share one rounding rule.
--
-- WHY set_by_user_id NOT NULL REFERENCES users(id). Mirrors
-- `policies.imposed_by_user_id`: an admin-set configuration row records who
-- set it, and ON DELETE RESTRICT keeps that attribution from silently
-- disappearing if the setter's account is later removed.
--
-- WHY UNIQUE ON (department_id, start_date, end_date). One target per
-- department per period — a second row for the same period would make "the"
-- plan ambiguous, so upsert (not insert) is the only way to change it.

-- migrate:up

CREATE TABLE IF NOT EXISTS cost_plans (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    target_amount DECIMAL(10, 2) NOT NULL,
    set_by_user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_cost_plans_department_period (department_id, start_date, end_date),
    INDEX idx_cost_plans_dates (start_date, end_date),

    CONSTRAINT chk_cost_plans_target_amount CHECK (target_amount >= 0),
    CONSTRAINT chk_cost_plans_period CHECK (end_date >= start_date),

    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (set_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

-- migrate:down

DROP TABLE IF EXISTS cost_plans;
