import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { database } from '../config/database';
import { config } from '../config';
import { User, CreateUserRequest, LoginRequest, LoginResponse } from '../types';
import { logger } from '../config/logger';

export class UserService {
  async createUser(userData: CreateUserRequest): Promise<User> {
    const { username, email, password, firstName, lastName, role } = userData;
    
    // Check if user already exists
    const existingUser = await this.findByUsername(username);
    if (existingUser) {
      throw new Error('User already exists');
    }

    // Check if email already exists
    const existingEmail = await this.findByEmail(email);
    if (existingEmail) {
      throw new Error('Email already in use');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, config.security.bcryptRounds);

    // Insert user
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

    logger.info(`User created: ${username}`, { userId, email, role });
    return user;
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { username, email, password } = credentials;
    
    if (!username && !email) {
      throw new Error('Username or email is required');
    }

    // Try to find user by username or email
    let user: User | null = null;
    
    if (username) {
      user = await this.findByUsername(username);
    } else if (email) {
      user = await this.findByEmail(email);
    }

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      },
      config.jwt.secret
    );

    // Remove password hash from response
    const { passwordHash, ...userWithoutPassword } = user;

    logger.info(`User logged in: ${username || email}`, { userId: user.id });

    return {
      user: userWithoutPassword as User,
      token,
    };
  }

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

  async updatePassword(id: number, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    const query = `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`;
    await database.query(query, [hashedPassword, id]);
    logger.info(`Password updated for user: ${id}`);
  }

  async deactivateUser(id: number): Promise<void> {
    const query = `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ?`;
    await database.query(query, [id]);
    logger.info(`User deactivated: ${id}`);
  }

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

  async verifyToken(token: string): Promise<User | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      return this.findById(decoded.userId);
    } catch (error) {
      logger.warn('Invalid token verification attempt', { error: (error as Error).message });
      return null;
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

export const userService = new UserService();
