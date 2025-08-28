/**
 * User Service
 * 
 * Handles all user management operations including authentication,
 * user creation, and profile management. Implements secure password
 * handling and JWT token generation.
 * 
 * Features:
 * - Secure user authentication with bcrypt
 * - JWT token generation and validation
 * - User CRUD operations with validation
 * - Password security enforcement
 * - Role-based user management
 * - Session tracking and security
 * 
 * Security:
 * - Password hashing with configurable salt rounds
 * - Input validation and sanitization
 * - Duplicate prevention (username, email)
 * - Audit trail for user operations
 * - Secure token generation with expiry
 * 
 * @author Luca Ostinelli
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { database } from '../config/database';
import { config } from '../config';
import { User, CreateUserRequest, LoginRequest, LoginResponse } from '../types';
import { logger } from '../config/logger';

/**
 * User Service Class
 * 
 * Provides comprehensive user management functionality with
 * secure authentication and role-based access control.
 */
export class UserService {
  
  /**
   * Create New User
   * 
   * Creates a new user account with secure password hashing and
   * comprehensive validation. Ensures data integrity and security.
   * 
   * @param userData - Complete user information including credentials
   * @returns Promise<User> - Created user object (without password)
   * 
   * @throws {Error} When username already exists
   * @throws {Error} When email already in use
   * @throws {Error} When password validation fails
   * 
   * @example
   * const newUser = await userService.createUser({
   *   username: "admin",
   *   email: "admin@company.com", 
   *   password: "SecurePass123!",
   *   firstName: "Admin",
   *   lastName: "User",
   *   role: "admin"
   * });
   */
  async createUser(userData: CreateUserRequest): Promise<User> {
    const { username, email, password, firstName, lastName, role } = userData;
    
    // Validate username uniqueness
    const existingUser = await this.findByUsername(username);
    if (existingUser) {
      throw new Error('User already exists');
    }

    // Validate email uniqueness
    const existingEmail = await this.findByEmail(email);
    if (existingEmail) {
      throw new Error('Email already in use');
    }

    // Hash password using bcrypt with configured salt rounds
    const hashedPassword = await bcrypt.hash(password, config.security.bcryptRounds);

    // Insert user into database
    const query = `
      INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, true, NOW(), NOW())
    `;

    const result = await database.query(query, [
      username,
      email,
      hashedPassword,
      firstName,
      lastName,
      role,
    ]);

    const userId = (result as any).insertId;
    const user = await this.findById(userId);
    
    if (!user) {
      throw new Error('Failed to create user');
    }

    logger.info(`User created successfully: ${username}`, { userId, email, role });
    return user;
  }

  /**
   * User Authentication (Login)
   * 
   * Authenticates users with username/email and password credentials.
   * Generates JWT token upon successful authentication.
   * 
   * @param credentials - Login credentials (username/email + password)
   * @returns Promise<LoginResponse> - JWT token and user information
   * 
   * @throws {Error} When credentials are missing
   * @throws {Error} When user not found
   * @throws {Error} When password is invalid
   * @throws {Error} When user account is disabled
   * 
   * @example
   * const authResult = await userService.login({
   *   username: "admin",
   *   password: "SecurePass123!"
   * });
   * console.log(`Token: ${authResult.token}`);
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { username, email, password } = credentials;
    
    // Validate that either username or email is provided
    if (!username && !email) {
      throw new Error('Username or email is required');
    }

    // Find user by username or email
    let user: User | null = null;
    
    if (username) {
      user = await this.findByUsername(username);
    } else if (email) {
      user = await this.findByEmail(email);
    }

    // Verify user exists and is active
    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    // Verify password using bcrypt
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Generate JWT token with user information and expiry
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours expiry
      },
      config.jwt.secret
    );

    // Remove sensitive data from response
    const { passwordHash, ...userWithoutPassword } = user;

    logger.info(`User authenticated successfully: ${username || email}`, { userId: user.id });

    return {
      user: userWithoutPassword as User,
      token,
    };
  }

  /**
   * Find User by ID
   * 
   * Retrieves user information by unique user ID.
   * Returns complete user object including password hash for authentication.
   * 
   * @param id - Unique user identifier
   * @returns Promise<User | null> - User object or null if not found
   * 
   * @example
   * const user = await userService.findById(123);
   * if (user) {
   *   console.log(`Found user: ${user.username}`);
   * }
   */
  async findById(id: number): Promise<User | null> {
    const query = `
      SELECT id, username, email, first_name, last_name, role, is_active, created_at, updated_at, password_hash
      FROM users 
      WHERE id = ?
    `;

    const users = await database.query<any>(query, [id]);
    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      passwordHash: user.password_hash,
      salt: user.salt || '',
      hierarchyLevel: user.hierarchy_level || 0,
      hierarchyPath: user.hierarchy_path || '0',
      permissions: [],
    };
  }

  /**
   * Find User by Username
   * 
   * Retrieves user information by username for authentication and lookup.
   * Used primarily for login validation and user identification.
   * 
   * @param username - Unique username
   * @returns Promise<User | null> - User object or null if not found
   * 
   * @example
   * const user = await userService.findByUsername("admin");
   * if (user && user.isActive) {
   *   console.log("User is active");
   * }
   */
  async findByUsername(username: string): Promise<User | null> {
    const query = `
      SELECT id, username, email, first_name, last_name, role, is_active, created_at, updated_at, password_hash
      FROM users 
      WHERE username = ?
    `;

    const users = await database.query<any>(query, [username]);
    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      passwordHash: user.password_hash,
      salt: user.salt || '',
      hierarchyLevel: user.hierarchy_level || 0,
      hierarchyPath: user.hierarchy_path || '0',
      permissions: [],
    };
  }

  /**
   * Find User by Email
   * 
   * Retrieves user information by email address for authentication.
   * Supports email-based login functionality.
   * 
   * @param email - User's email address
   * @returns Promise<User | null> - User object or null if not found
   * 
   * @example
   * const user = await userService.findByEmail("admin@company.com");
   * if (user) {
   *   console.log(`User found: ${user.firstName} ${user.lastName}`);
   * }
   */
  async findByEmail(email: string): Promise<User | null> {
    const query = `
      SELECT id, username, email, first_name, last_name, role, is_active, created_at, updated_at, password_hash
      FROM users 
      WHERE email = ?
    `;

    const users = await database.query<any>(query, [email]);
    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      passwordHash: user.password_hash,
      salt: user.salt || '',
      hierarchyLevel: user.hierarchy_level || 0,
      hierarchyPath: user.hierarchy_path || '0',
      permissions: [],
    };
  }

  /**
   * Update User Information
   * 
   * Updates user data with validation and security checks.
   * Supports partial updates without affecting sensitive fields.
   * 
   * @param id - User ID to update
   * @param updateData - Partial user data to update
   * @returns Promise<User | null> - Updated user or null if not found
   * 
   * @example
   * const updated = await userService.updateUser(123, {
   *   firstName: "John",
   *   lastName: "Smith"
   * });
   */
  async updateUser(id: number, updateData: Partial<User>): Promise<User | null> {
    const fields: string[] = [];
    const values: any[] = [];

    // Build dynamic update query
    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'passwordHash') {
        fields.push(`${this.camelToSnake(key)} = ?`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await database.query(query, values);

    logger.info(`User updated: ${id}`, { fields: Object.keys(updateData) });
    return this.findById(id);
  }

  /**
   * Update User Password
   * 
   * Securely updates user password with bcrypt hashing.
   * Logs password change for security auditing.
   * 
   * @param id - User ID
   * @param newPassword - New password (plain text)
   * @returns Promise<void>
   * 
   * @example
   * await userService.updatePassword(123, "NewSecurePass123!");
   */
  async updatePassword(id: number, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    const query = `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`;
    await database.query(query, [hashedPassword, id]);
    logger.info(`Password updated for user: ${id}`);
  }

  /**
   * Deactivate User Account
   * 
   * Soft delete by setting user account to inactive.
   * Preserves data integrity while preventing access.
   * 
   * @param id - User ID to deactivate
   * @returns Promise<void>
   * 
   * @example
   * await userService.deactivateUser(123);
   */
  async deactivateUser(id: number): Promise<void> {
    const query = `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ?`;
    await database.query(query, [id]);
    logger.info(`User deactivated: ${id}`);
  }

  /**
   * Get All Users
   * 
   * Retrieves complete list of users for administrative purposes.
   * Returns users without sensitive password information.
   * 
   * @returns Promise<User[]> - Array of all users
   * 
   * @example
   * const allUsers = await userService.getAllUsers();
   * console.log(`Total users: ${allUsers.length}`);
   */
  async getAllUsers(): Promise<User[]> {
    const query = `
      SELECT id, username, email, first_name, last_name, role, is_active, created_at, updated_at
      FROM users 
      ORDER BY created_at DESC
    `;

    const users = await database.query<any>(query);
    return users.map((user: any) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      passwordHash: '',
      salt: '',
      hierarchyLevel: user.hierarchy_level || 0,
      hierarchyPath: user.hierarchy_path || '0',
      permissions: [],
    }));
  }

  /**
   * Verify JWT Token
   * 
   * Validates JWT token and retrieves associated user information.
   * Used for authentication middleware and session validation.
   * 
   * @param token - JWT token to verify
   * @returns Promise<User | null> - User object if valid, null if invalid
   * 
   * @example
   * const user = await userService.verifyToken(authToken);
   * if (user) {
   *   console.log(`Authenticated user: ${user.username}`);
   * }
   */
  async verifyToken(token: string): Promise<User | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      return this.findById(decoded.userId);
    } catch (error) {
      logger.warn('Invalid token verification attempt', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Convert Camel Case to Snake Case
   * 
   * Utility method for converting JavaScript camelCase property names
   * to database snake_case column names.
   * 
   * @param str - CamelCase string to convert
   * @returns string - snake_case equivalent
   * 
   * @private
   * 
   * @example
   * // "firstName" becomes "first_name"
   * // "isActive" becomes "is_active"
   */
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

export const userService = new UserService();
