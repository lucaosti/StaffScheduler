-- migrate:up

-- DEPARTMENT GEOFENCES TABLE - polygon fences clock-in is validated against
CREATE TABLE IF NOT EXISTS department_geofences (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    -- Array of {lat, lng} vertices, in order, defining a simple polygon.
    -- Stored as JSON rather than a PostGIS-style geometry column because this
    -- is MySQL without a spatial index requirement here: department fence
    -- counts are small (a handful per department) and the point-in-polygon
    -- check runs in application code, not in a spatial query.
    polygon JSON NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_geofence_department (department_id),
    INDEX idx_geofence_active (is_active),

    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- Optional punch coordinates. NULL when the caller didn't send a location
-- (either the device denied geolocation, or the caller's departments have no
-- active geofence and the frontend never asked for one).
ALTER TABLE attendance_records
    ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER clock_in,
    ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude;

-- migrate:down

ALTER TABLE attendance_records
    DROP COLUMN latitude,
    DROP COLUMN longitude;

DROP TABLE IF EXISTS department_geofences;

