/**
 * Schema helper for integration tests.
 *
 * Reads the dbmate migration files under `db/migrations` and returns the
 * concatenated `migrate:up` sections in filename (i.e. chronological) order,
 * so tests can apply the exact schema the application deploys with — without
 * shelling out to the dbmate binary from inside Jest.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'db', 'migrations');

/**
 * Concatenated SQL of every migration's `migrate:up` section, in order.
 * Execute with a mysql2 connection created with `multipleStatements: true`.
 */
export const migrationUpSql = (): string =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const upSection = raw.split(/^--\s*migrate:down\s*$/m)[0];
      return upSection.replace(/^--\s*migrate:up\s*$/m, '');
    })
    .join('\n');
