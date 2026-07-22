/**
 * Utility Functions for Staff Scheduler Backend
 * 
 * Collection of common utility functions for cryptography, validation,
 * data transformation, and general-purpose operations.
 * 
 * Modules:
 * - CryptoUtils: Password hashing and token generation
 * - ValidationUtils: Input validation and sanitization
 * - DateUtils: Date/time manipulation and formatting
 * - StringUtils: String processing and transformation
 * 
 * @author Luca Ostinelli
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { config } from '../config';

/**
 * Cryptographic utility functions for secure password handling
 * and token generation.
 */
export class CryptoUtils {
  /**
   * Hash a password using bcrypt with salt
   * @param password - Plain text password to hash
   * @returns Promise resolving to hash and salt
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
   * Extracts "YYYY-MM-DD" from a Date using its *local* calendar
   * components, not `.toISOString()`. mysql2 materializes a DATE column as
   * a JS Date at local midnight (not UTC midnight) — `.toISOString()` on
   * that value converts to UTC and silently rolls back to the previous day
   * in any positive UTC-offset timezone (e.g. Europe/Rome). Use this for
   * every DATE column read back from the database; only use
   * `.toISOString()` for values that are genuinely UTC-anchored.
   */
  static fromMySQLDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
   * Parses a DB-stored JSON string expected to contain an array of strings.
   * Returns [] on malformed JSON or a non-array value instead of throwing,
   * so one corrupted row can never take down a whole request (the RBAC
   * delegation path runs on every authenticated request).
   */
  static parseStringArray(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    if (typeof raw !== 'string' || raw.length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

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

}
