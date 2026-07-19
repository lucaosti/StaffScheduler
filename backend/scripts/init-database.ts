#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import * as fs from 'fs';
import mysql from 'mysql2/promise';
import * as path from 'path';
import { logger } from '../src/config/logger';

dotenv.config();

type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const DB_CONFIG: DbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'staff_scheduler',
};

async function ensureDatabase(connection: mysql.Connection, dbName: string) {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${dbName}\``);
}

/**
 * Marker splitting init.sql into an idempotent head (CREATE TABLE IF NOT
 * EXISTS + INSERT IGNORE) and a tail of statements MySQL cannot express
 * idempotently (ADD CONSTRAINT, CREATE INDEX). The head is executed as-is;
 * each tail statement is guarded by an information_schema existence check so
 * db:init can be re-run safely against an existing database.
 */
const NON_IDEMPOTENT_TAIL_MARKER = '-- DEFERRED FOREIGN KEYS';

const stripSqlComments = (statement: string): string =>
  statement
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

async function runGuardedStatement(
  connection: mysql.Connection,
  dbName: string,
  statement: string
) {
  const constraintMatch = /ADD\s+CONSTRAINT\s+`?(\w+)`?/i.exec(statement);
  if (constraintMatch) {
    const [rows] = await connection.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
      [dbName, constraintMatch[1]]
    );
    if ((rows as unknown[]).length > 0) return;
    logger.info(`Adding missing constraint ${constraintMatch[1]}`);
    await connection.query(statement);
    return;
  }

  const indexMatch = /CREATE\s+INDEX\s+`?(\w+)`?\s+ON\s+`?(\w+)`?/i.exec(statement);
  if (indexMatch) {
    const [rows] = await connection.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [dbName, indexMatch[2], indexMatch[1]]
    );
    if ((rows as unknown[]).length > 0) return;
    logger.info(`Adding missing index ${indexMatch[2]}.${indexMatch[1]}`);
    await connection.query(statement);
    return;
  }

  await connection.query(statement);
}

async function runSchemaSql(connection: mysql.Connection, dbName: string) {
  const schemaPath = path.join(__dirname, '../database/init.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const markerIndex = schemaSql.indexOf(NON_IDEMPOTENT_TAIL_MARKER);
  if (markerIndex === -1) {
    await connection.query(schemaSql);
    return;
  }

  await connection.query(schemaSql.slice(0, markerIndex));

  // Strip comment lines BEFORE splitting on ';' — comments may legitimately
  // contain semicolons and must never produce phantom statements.
  const tailStatements = stripSqlComments(schemaSql.slice(markerIndex))
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of tailStatements) {
    await runGuardedStatement(connection, dbName, statement);
  }
}

/**
 * Columns added to existing tables after their initial CREATE.
 *
 * `CREATE TABLE IF NOT EXISTS` in init.sql cannot evolve tables that already
 * exist, so re-running db:init on an existing database would silently skip
 * new columns. Each entry here is applied idempotently (guarded by an
 * information_schema lookup, since MySQL has no ADD COLUMN IF NOT EXISTS),
 * which keeps db:init a valid upgrade path.
 */
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: 'users',
    column: 'totp_last_counter',
    ddl: 'ALTER TABLE users ADD COLUMN totp_last_counter BIGINT NULL AFTER totp_recovery_codes',
  },
];

async function ensureColumns(connection: mysql.Connection, dbName: string) {
  for (const m of COLUMN_MIGRATIONS) {
    const [rows] = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
      [dbName, m.table, m.column]
    );
    if ((rows as unknown[]).length === 0) {
      logger.info(`Adding missing column ${m.table}.${m.column}`);
      await connection.query(m.ddl);
    }
  }
}

export async function initializeDatabase(): Promise<void> {
  let connection: mysql.Connection | null = null;

  try {
    logger.info('Starting database initialization...');

    connection = await mysql.createConnection({
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
      multipleStatements: true,
    });

    await ensureDatabase(connection, DB_CONFIG.database);
    await runSchemaSql(connection, DB_CONFIG.database);
    await ensureColumns(connection, DB_CONFIG.database);

    logger.info('Database initialization completed successfully');
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

