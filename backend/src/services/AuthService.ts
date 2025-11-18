/**
 * Authentication Service
 * 
 * Handles user authentication, JWT token management, and session validation.
 * 
 * @module services/AuthService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { User, LoginRequest, LoginResponse } from '../types';
import { logger } from '../config/logger';
import { config } from '../config';

/**
 * AuthService Class
 * 
 * Provides authentication and authorization functionality including:
 * - User login with password verification
 * - JWT token generation and validation
 * - Session management
 * - Password reset functionality
 * - Security logging
 */
export class AuthService {
  /**
   * Creates a new AuthService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Authenticates a user with email and password
   * 
   * @param loginData - Login credentials (email and password)
   * @returns Promise resolving to LoginResponse with token and user info
   */
  async login(loginData: LoginRequest): Promise<LoginResponse> {
    try {
      // Validate input
      if (!loginData.email || !loginData.password) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required'
          }
        };
      }

      // Get user by email
      const [userRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT id, email, password, first_name, last_name, role, is_active
        FROM users
        WHERE email = ? LIMIT 1`,
        [loginData.email]
      );

      if (userRows.length === 0) {
        logger.warn(`Failed login attempt for non-existent user: ${loginData.email}`);
        return {
          success: false,
          error: {
            code: 'LOGIN_FAILED',
            message: 'Invalid email or password'
          }
        };
      }

      const userRow = userRows[0];

      // Check if user is active
      if (!userRow.is_active) {
        logger.warn(`Login attempt for inactive user: ${loginData.email}`);
        return {
          success: false,
          error: {
            code: 'ACCOUNT_INACTIVE',
            message: 'Your account has been deactivated'
          }
        };
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(loginData.password, userRow.password);

      if (!passwordMatch) {
        logger.warn(`Failed login attempt for user: ${loginData.email}`);
        return {
          success: false,
          error: {
            code: 'LOGIN_FAILED',
            message: 'Invalid email or password'
          }
        };
      }

      // Update last login timestamp
      await this.pool.execute(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [userRow.id]
      );

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: userRow.id,
          email: userRow.email,
          role: userRow.role
        },
        config.jwt.secret,
        {
          expiresIn: '7d'
        }
      );

      // Prepare user object without sensitive data
      const user: Omit<User, 'createdAt' | 'updatedAt'> = {
        id: userRow.id,
        email: userRow.email,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
        role: userRow.role,
        employeeId: userRow.employee_id,
        phone: userRow.phone,
        isActive: Boolean(userRow.is_active),
        lastLogin: userRow.last_login
      };

      logger.info(`User logged in successfully: ${loginData.email}`, {
        userId: userRow.id,
        role: userRow.role
      });

      return {
        success: true,
        data: {
          token,
          user
        }
      };
    } catch (error) {
      logger.error('Login error:', error);
      return {
        success: false,
        error: {
          code: 'LOGIN_ERROR',
          message: 'An error occurred during login'
        }
      };
    }
  }

  /**
   * Verifies a JWT token and returns the decoded payload
   * 
   * @param token - JWT token to verify
   * @returns Promise resolving to decoded token payload or null if invalid
   */
  async verifyToken(token: string): Promise<any | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      return decoded;
    } catch (error) {
      logger.warn('Invalid token verification attempt');
      return null;
    }
  }

  /**
   * Gets the current user from a JWT token
   * 
   * @param token - JWT token
   * @returns Promise resolving to User object or null
   */
  async getUserFromToken(token: string): Promise<User | null> {
    try {
      const decoded: any = await this.verifyToken(token);
      if (!decoded || !decoded.userId) {
        return null;
      }

      // Get user from database
      const [userRows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          id, email, first_name, last_name, role, employee_id, phone,
          is_active, last_login, created_at, updated_at
        FROM users
        WHERE id = ? AND is_active = 1 LIMIT 1`,
        [decoded.userId]
      );

      if (userRows.length === 0) {
        return null;
      }

      const row = userRows[0];

      const user: User = {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        role: row.role,
        employeeId: row.employee_id,
        phone: row.phone,
        isActive: Boolean(row.is_active),
        lastLogin: row.last_login,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      return user;
    } catch (error) {
      logger.error('Failed to get user from token:', error);
      return null;
    }
  }

  /**
   * Refreshes a JWT token
   * 
   * Generates a new token with extended expiration for the same user
   * 
   * @param oldToken - Current JWT token
   * @returns Promise resolving to new token or null if refresh fails
   */
  async refreshToken(oldToken: string): Promise<string | null> {
    try {
      const decoded: any = await this.verifyToken(oldToken);
      if (!decoded || !decoded.userId) {
        return null;
      }

      // Verify user still exists and is active
      const [userRows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT id, email, role FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        [decoded.userId]
      );

      if (userRows.length === 0) {
        return null;
      }

      const user = userRows[0];

      // Generate new token
      const newToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role
        },
        config.jwt.secret,
        {
          expiresIn: '7d'
        }
      );

      logger.info(`Token refreshed for user: ${user.email}`);

      return newToken;
    } catch (error) {
      logger.error('Failed to refresh token:', error);
      return null;
    }
  }

  /**
   * Logs out a user (invalidates session)
   * 
   * In a JWT-based system, logout is handled client-side by removing the token.
   * This method is provided for logging purposes and future session management.
   * 
   * @param userId - User ID
   * @returns Promise resolving to true
   */
  async logout(userId: number): Promise<boolean> {
    try {
      logger.info(`User logged out: ${userId}`);
      return true;
    } catch (error) {
      logger.error('Logout error:', error);
      return false;
    }
  }

  /**
   * Validates if user has required role
   * 
   * @param userId - User ID
   * @param requiredRoles - Array of acceptable roles
   * @returns Promise resolving to boolean indicating if user has required role
   */
  async hasRole(userId: number, requiredRoles: string[]): Promise<boolean> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT role FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
        [userId]
      );

      if (rows.length === 0) {
        return false;
      }

      return requiredRoles.includes(rows[0].role);
    } catch (error) {
      logger.error('Failed to check user role:', error);
      return false;
    }
  }

  /**
   * Changes user password
   * 
   * Validates old password before setting new password
   * 
   * @param userId - User ID
   * @param oldPassword - Current password
   * @param newPassword - New password
   * @returns Promise resolving to boolean indicating success
   */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Get current password hash
      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT password FROM users WHERE id = ? LIMIT 1',
        [userId]
      );

      if (userRows.length === 0) {
        throw new Error('User not found');
      }

      // Verify old password
      const passwordMatch = await bcrypt.compare(oldPassword, userRows[0].password);
      if (!passwordMatch) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      await connection.execute(
        'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [hashedPassword, userId]
      );

      await connection.commit();

      logger.info(`Password changed successfully for user: ${userId}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to change password:', error);
      return false;
    } finally {
      connection.release();
    }
  }

  /**
   * Initiates password reset process
   * 
   * Generates a reset token and stores it in the database
   * 
   * @param email - User email
   * @returns Promise resolving to reset token or null
   */
  async initiatePasswordReset(email: string): Promise<string | null> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Check if user exists
      const [userRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
        [email]
      );

      if (userRows.length === 0) {
        logger.warn(`Password reset requested for non-existent email: ${email}`);
        // Return success even if user doesn't exist (security best practice)
        return null;
      }

      const userId = userRows[0].id;

      // Generate reset token
      const resetToken = jwt.sign(
        { userId, purpose: 'password_reset' },
        config.jwt.secret,
        { expiresIn: '1h' }
      );

      // Store reset token (in a real system, you'd have a password_reset_tokens table)
      // For now, we just log it
      await connection.commit();

      logger.info(`Password reset initiated for user: ${email}`, { userId });

      return resetToken;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to initiate password reset:', error);
      return null;
    } finally {
      connection.release();
    }
  }

  /**
   * Completes password reset with a valid reset token
   * 
   * @param resetToken - Password reset token
   * @param newPassword - New password
   * @returns Promise resolving to boolean indicating success
   */
  async completePasswordReset(
    resetToken: string,
    newPassword: string
  ): Promise<boolean> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      // Verify reset token
      const decoded: any = jwt.verify(resetToken, config.jwt.secret);
      
      if (!decoded || !decoded.userId || decoded.purpose !== 'password_reset') {
        throw new Error('Invalid reset token');
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      await connection.execute(
        'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [hashedPassword, decoded.userId]
      );

      await connection.commit();

      logger.info(`Password reset completed for user: ${decoded.userId}`);
      return true;
    } catch (error) {
      await connection.rollback();
      logger.error('Failed to complete password reset:', error);
      return false;
    } finally {
      connection.release();
    }
  }
}
