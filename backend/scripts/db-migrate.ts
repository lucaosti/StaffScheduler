#!/usr/bin/env ts-node

/**
 * Thin wrapper around the dbmate CLI that builds DATABASE_URL from the
 * project's discrete DB_* environment variables (backend/.env), so the
 * migration workflow uses the exact same configuration as the application.
 *
 * Usage (via npm scripts): up | status | rollback | new <name>
 * An explicit DATABASE_URL environment variable takes precedence.
 *
 * @author Luca Ostinelli
 */

import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const host = process.env.DB_HOST || 'localhost';
const port = process.env.DB_PORT || '3306';
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const name = process.env.DB_NAME || 'staff_scheduler';

const url =
  process.env.DATABASE_URL ||
  `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

const args = process.argv.slice(2);
if (args.length === 0) args.push('up');

const result = spawnSync(
  'npx',
  [
    'dbmate',
    '--migrations-dir',
    path.join(__dirname, '..', 'db', 'migrations'),
    '--no-dump-schema',
    ...args,
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  }
);

process.exit(result.status ?? 1);
