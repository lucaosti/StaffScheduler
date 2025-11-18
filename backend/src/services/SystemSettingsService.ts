/**
 * System Settings Service
 * 
 * Manages application-wide configuration settings including:
 * - Currency settings (EUR/USD)
 * - Time period defaults (Monthly)
 * - Other system preferences
 * 
 * @module services/SystemSettingsService
 * @author Staff Scheduler Team
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { SystemSetting } from '../types';
import { logger } from '../config/logger';

/**
 * SystemSettingsService Class
 * 
 * Provides system-wide configuration management with support for:
 * - Categorized settings
 * - Type-safe value storage
 * - Default value fallback
 * - Setting reset functionality
 */
export class SystemSettingsService {
  /**
   * Creates a new SystemSettingsService instance
   * 
   * @param pool - MySQL connection pool for database operations
   */
  constructor(private pool: Pool) {}

  /**
   * Gets all system settings
   * 
   * @returns Promise resolving to array of all settings
   */
  async getAllSettings(): Promise<SystemSetting[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          id,
          category,
          \`key\`,
          value,
          type,
          default_value AS defaultValue,
          description,
          is_editable AS isEditable,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM system_settings
        ORDER BY category, \`key\``
      );

      return rows as SystemSetting[];
    } catch (error) {
      logger.error('Error getting all settings:', error);
      throw error;
    }
  }

  /**
   * Gets settings by category
   * 
   * @param category - Setting category (e.g., 'general', 'scheduling', 'notifications')
   * @returns Promise resolving to array of settings in the category
   */
  async getSettingsByCategory(category: string): Promise<SystemSetting[]> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT 
          id,
          category,
          \`key\`,
          value,
          type,
          default_value AS defaultValue,
          description,
          is_editable AS isEditable,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM system_settings
        WHERE category = ?
        ORDER BY \`key\``,
        [category]
      );

      return rows as SystemSetting[];
    } catch (error) {
      logger.error('Error getting settings by category:', error);
      throw error;
    }
  }

  /**
   * Gets a specific setting value
   * 
   * @param category - Setting category
   * @param key - Setting key
   * @returns Promise resolving to the setting value or default value
   */
  async getSetting(category: string, key: string): Promise<string> {
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT value, default_value AS defaultValue FROM system_settings WHERE category = ? AND `key` = ? LIMIT 1',
        [category, key]
      );

      if (rows.length === 0) {
        throw new Error(`Setting not found: ${category}.${key}`);
      }

      return rows[0].value || rows[0].defaultValue;
    } catch (error) {
      logger.error('Error getting setting:', error);
      throw error;
    }
  }

  /**
   * Updates a setting value
   * 
   * @param category - Setting category
   * @param key - Setting key
   * @param value - New value
   * @returns Promise resolving to the updated setting
   */
  async updateSetting(category: string, key: string, value: string): Promise<SystemSetting> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Check if setting exists and is editable
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id, is_editable AS isEditable FROM system_settings WHERE category = ? AND `key` = ? LIMIT 1',
        [category, key]
      );

      if (existingRows.length === 0) {
        throw new Error(`Setting not found: ${category}.${key}`);
      }

      if (!existingRows[0].isEditable) {
        throw new Error(`Setting ${category}.${key} is not editable`);
      }

      await connection.execute(
        'UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND `key` = ?',
        [value, category, key]
      );

      const [updatedRows] = await connection.execute<RowDataPacket[]>(
        `SELECT 
          id,
          category,
          \`key\`,
          value,
          type,
          default_value AS defaultValue,
          description,
          is_editable AS isEditable,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM system_settings
        WHERE category = ? AND \`key\` = ?
        LIMIT 1`,
        [category, key]
      );

      await connection.commit();
      
      logger.info(`Setting ${category}.${key} updated to: ${value}`);
      return updatedRows[0] as SystemSetting;
    } catch (error) {
      await connection.rollback();
      logger.error('Error updating setting:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Resets a setting to its default value
   * 
   * @param category - Setting category
   * @param key - Setting key
   * @returns Promise resolving to the reset setting
   */
  async resetSetting(category: string, key: string): Promise<SystemSetting> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Get default value
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT default_value AS defaultValue FROM system_settings WHERE category = ? AND `key` = ? LIMIT 1',
        [category, key]
      );

      if (rows.length === 0) {
        throw new Error(`Setting not found: ${category}.${key}`);
      }

      const defaultValue = rows[0].defaultValue;

      await connection.execute(
        'UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND `key` = ?',
        [defaultValue, category, key]
      );

      const [updatedRows] = await connection.execute<RowDataPacket[]>(
        `SELECT 
          id,
          category,
          \`key\`,
          value,
          type,
          default_value AS defaultValue,
          description,
          is_editable AS isEditable,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM system_settings
        WHERE category = ? AND \`key\` = ?
        LIMIT 1`,
        [category, key]
      );

      await connection.commit();
      
      logger.info(`Setting ${category}.${key} reset to default: ${defaultValue}`);
      return updatedRows[0] as SystemSetting;
    } catch (error) {
      await connection.rollback();
      logger.error('Error resetting setting:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Gets the currency setting (EUR or USD)
   * 
   * @returns Promise resolving to currency code
   */
  async getCurrency(): Promise<string> {
    try {
      return await this.getSetting('general', 'currency');
    } catch (error) {
      logger.warn('Currency setting not found, returning default EUR');
      return 'EUR';
    }
  }

  /**
   * Sets the currency setting
   * 
   * @param currency - Currency code (EUR or USD)
   * @returns Promise resolving when complete
   */
  async setCurrency(currency: 'EUR' | 'USD'): Promise<void> {
    try {
      await this.updateSetting('general', 'currency', currency);
    } catch (error) {
      logger.error('Error setting currency:', error);
      throw error;
    }
  }

  /**
   * Gets the time period setting
   * 
   * @returns Promise resolving to time period (e.g., 'monthly', 'weekly')
   */
  async getTimePeriod(): Promise<string> {
    try {
      return await this.getSetting('general', 'time_period');
    } catch (error) {
      logger.warn('Time period setting not found, returning default monthly');
      return 'monthly';
    }
  }

  /**
   * Sets the time period setting
   * 
   * @param timePeriod - Time period value
   * @returns Promise resolving when complete
   */
  async setTimePeriod(timePeriod: string): Promise<void> {
    try {
      await this.updateSetting('general', 'time_period', timePeriod);
    } catch (error) {
      logger.error('Error setting time period:', error);
      throw error;
    }
  }

  /**
   * Initializes default system settings if they don't exist
   * 
   * This method is called during system initialization to ensure
   * all required settings are present.
   * 
   * @returns Promise resolving when complete
   */
  async initializeDefaults(): Promise<void> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();

      const defaultSettings = [
        {
          category: 'general',
          key: 'currency',
          value: 'EUR',
          type: 'string',
          default_value: 'EUR',
          description: 'Default currency for the application (EUR or USD)',
          is_editable: true
        },
        {
          category: 'general',
          key: 'time_period',
          value: 'monthly',
          type: 'string',
          default_value: 'monthly',
          description: 'Default time period for scheduling (monthly, weekly, daily)',
          is_editable: true
        },
        {
          category: 'scheduling',
          key: 'max_shifts_per_week',
          value: '5',
          type: 'number',
          default_value: '5',
          description: 'Maximum number of shifts an employee can work per week',
          is_editable: true
        },
        {
          category: 'scheduling',
          key: 'min_hours_between_shifts',
          value: '8',
          type: 'number',
          default_value: '8',
          description: 'Minimum hours required between shifts for the same employee',
          is_editable: true
        }
      ];

      for (const setting of defaultSettings) {
        await connection.execute(
          `INSERT INTO system_settings 
          (category, \`key\`, value, type, default_value, description, is_editable)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE category = category`,
          [
            setting.category,
            setting.key,
            setting.value,
            setting.type,
            setting.default_value,
            setting.description,
            setting.is_editable
          ]
        );
      }

      await connection.commit();
      logger.info('Default system settings initialized');
    } catch (error) {
      await connection.rollback();
      logger.error('Error initializing default settings:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}
