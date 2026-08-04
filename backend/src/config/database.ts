/**
 * The one exception to "no global service singletons": every other service
 * receives its pool through the router-factory injection chain rooted in
 * `src/index.ts`, but health checks and the auth middleware run before and
 * outside that chain (a health check must answer even if request routing is
 * still being wired up), so they need a connection available without it.
 * This singleton exists to serve exactly those two callers — not as a second,
 * competing way to reach the database from application code, which should
 * always go through the injected pool.
 *
 * Pool sizing (`connectionLimit`, `queueLimit`, `connectTimeout`) comes from
 * `config.database`, not hardcoded here, so it can be tuned per deployment
 * without a code change.
 *
 * @author Luca Ostinelli
 */

import mysql from 'mysql2/promise';
import { config } from '../config';

/**
 * Database Class
 * 
 * Manages MySQL database connections and provides query execution utilities.
 * Implements connection pooling and transaction support for optimal performance.
 */
class Database {
  private pool: mysql.Pool;

  /**
   * Database Constructor
   * 
   * Initializes the MySQL connection pool with configuration parameters.
   * Sets up connection limits and queue management.
   */
  constructor() {
    this.pool = mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      waitForConnections: true,
      connectionLimit: config.database.connectionLimit,
      queueLimit: config.database.queueLimit,
      connectTimeout: config.database.connectTimeout,
    });
  }

  /**
   * Get Connection Pool
   * 
   * Returns the mysql connection pool for use in services.
   * 
   * @returns mysql.Pool - The connection pool instance
   */
  getPool(): mysql.Pool {
    return this.pool;
  }

  /**
   * Get Connection from Pool
   * 
   * Retrieves a connection from the pool for manual connection management.
   * Connection must be manually released after use.
   * 
   * @returns Promise<mysql.PoolConnection> - Database connection from pool
   */
  async getConnection(): Promise<mysql.PoolConnection> {
    return this.pool.getConnection();
  }

  /**
   * Test Database Connection
   * 
   * Validates database connectivity by sending a ping command.
   * Used for health checks and startup validation.
   * 
   * @throws {Error} When database connection fails
   */
  async testConnection(): Promise<void> {
    const connection = await this.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  }

  /**
   * Execute Database Query
   * 
   * Executes a SQL query with optional parameters using prepared statements.
   * Automatically manages connection lifecycle.
   * 
   * @param sql - SQL query string
   * @param params - Optional query parameters for prepared statements
   * @returns Promise<T[]> - Array of query results
   * 
   * @example
   * const users = await database.query<User>('SELECT * FROM users WHERE active = ?', [true]);
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const connection = await this.getConnection();
    try {
      const [rows] = await connection.execute(sql, params);
      return rows as T[];
    } finally {
      connection.release();
    }
  }

  /**
   * Execute Single Result Query
   * 
   * Executes a query expecting a single result or null.
   * Convenience method for queries that return one record.
   * 
   * @param sql - SQL query string
   * @param params - Optional query parameters
   * @returns Promise<T | null> - Single result or null if no results
   * 
   * @example
   * const user = await database.queryOne<User>('SELECT * FROM users WHERE id = ?', [123]);
   */
  async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute Database Transaction
   * 
   * Executes multiple database operations within a transaction.
   * Automatically handles commit/rollback based on success/failure.
   * 
   * @param callback - Function containing transaction operations
   * @returns Promise<T> - Result from callback function
   * 
   * @example
   * await database.transaction(async (connection) => {
   *   await connection.execute('INSERT INTO users ...', [data]);
   *   await connection.execute('UPDATE counters ...', [id]);
   * });
   */
  async transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Close Database Connection Pool
   * 
   * Gracefully closes all connections in the pool.
   * Should be called during application shutdown.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Check Database Connection Health
   * 
   * Performs a simple query to verify database connectivity.
   * Returns boolean indicating connection health status.
   * 
   * @returns Promise<boolean> - True if connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Database Instance Export
 *
 * Exports a singleton instance of the Database class for
 * consistent usage across the application.
 */
export const database = new Database();

/**
 * The read-pool selection seam for #323: routes analytical SELECTs (reports,
 * calendar feed generation, audit log listing/export) to a MySQL read
 * replica when one is configured.
 *
 * Returns the SAME pool object, not a second pool pointed at the same host,
 * when `DB_REPLICA_HOST` is unset — so a single-instance deployment is
 * genuinely unaffected, not just "configured to point at itself": there is
 * no extra connection budget, no extra pool to close on shutdown, and every
 * read-replica-aware service falls back to querying the primary through the
 * exact same pool instance it always has.
 */
export function createReadPool(primaryPool: mysql.Pool): mysql.Pool {
  if (!config.database.replicaHost) return primaryPool;
  return mysql.createPool({
    host: config.database.replicaHost,
    port: config.database.replicaPort,
    user: config.database.replicaUser,
    password: config.database.replicaPassword,
    database: config.database.replicaDatabase,
    waitForConnections: true,
    connectionLimit: config.database.replicaConnectionLimit,
    queueLimit: config.database.queueLimit,
    connectTimeout: config.database.connectTimeout,
  });
}
