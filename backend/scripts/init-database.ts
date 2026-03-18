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

async function runSchemaSql(connection: mysql.Connection) {
  const schemaPath = path.join(__dirname, '../database/init.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await connection.query(schemaSql);
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
    await runSchemaSql(connection);

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

