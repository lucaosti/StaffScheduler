import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { config } from '../config';

export class CryptoUtils {
  /**
   * Hash a password using bcrypt
   */
  static async hashPassword(password: string): Promise<{ hash: string; salt: string }> {
    const salt = await bcrypt.genSalt(config.security.bcryptRounds);
    const hash = await bcrypt.hash(password, salt);
    return { hash, salt };
  }

  /**
   * Verify a password against a hash
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a random token
   */
  static generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a UUID v4
   */
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Generate a secure random salt
   */
  static generateSalt(length: number = 16): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

export class DateUtils {
  /**
   * Convert Date to MySQL datetime format
   */
  static toMySQLDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * Convert Date to MySQL date format
   */
  static toMySQLDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Add days to a date
   */
  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Check if date is within range
   */
  static isWithinRange(date: Date, start: Date, end: Date): boolean {
    return date >= start && date <= end;
  }

  /**
   * Get start of day
   */
  static startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get end of day
   */
  static endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }
}

export class ValidationUtils {
  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  static isValidPassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate UUID format
   */
  static isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(input: string): string {
    return input.trim().replace(/[<>]/g, '');
  }
}

export class HierarchyUtils {
  /**
   * Build materialized path for hierarchy
   */
  static buildPath(parentPath: string | null, nodeId: string): string {
    if (!parentPath) {
      return '0'; // Root level
    }
    return `${parentPath}.${nodeId}`;
  }

  /**
   * Get hierarchy level from path
   */
  static getLevel(path: string): number {
    return path.split('.').length - 1;
  }

  /**
   * Check if child is descendant of parent
   */
  static isDescendant(childPath: string, parentPath: string): boolean {
    return childPath.startsWith(parentPath + '.') || childPath === parentPath;
  }

  /**
   * Get all parent paths from a given path
   */
  static getParentPaths(path: string): string[] {
    const parts = path.split('.');
    const paths: string[] = [];
    
    for (let i = 1; i <= parts.length; i++) {
      paths.push(parts.slice(0, i).join('.'));
    }
    
    return paths;
  }

  /**
   * Find common ancestor path
   */
  static findCommonAncestor(path1: string, path2: string): string {
    const parts1 = path1.split('.');
    const parts2 = path2.split('.');
    const commonParts: string[] = [];
    
    const minLength = Math.min(parts1.length, parts2.length);
    for (let i = 0; i < minLength; i++) {
      if (parts1[i] === parts2[i]) {
        commonParts.push(parts1[i]);
      } else {
        break;
      }
    }
    
    return commonParts.join('.');
  }
}

export class ResponseUtils {
  /**
   * Create standardized API response
   */
  static success<T>(data: T, meta?: any) {
    return {
      success: true,
      data,
      meta
    };
  }

  /**
   * Create standardized error response
   */
  static error(code: string, message: string, details?: any) {
    return {
      success: false,
      error: {
        code,
        message,
        details
      }
    };
  }

  /**
   * Create paginated response
   */
  static paginated<T>(data: T[], total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit);
    
    return {
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }
}
