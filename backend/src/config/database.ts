/**
 * Database Configuration and Connection Manager
 * 
 * Provides MySQL database connection management with connection pooling,
 * query execution utilities, transaction support, and health monitoring.
 * 
 * Features:
 * - Connection pooling for optimal performance
 * - Prepared statement support
 * - Transaction management
 * - Connection health monitoring
 * - Error handling and logging
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
      queueLimit: 0,
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
  }  /**
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
export default database;
