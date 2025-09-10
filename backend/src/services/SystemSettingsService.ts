/**
 * System Settings Service
 * 
 * Manages application-wide configuration settings including:
 * - Currency selection (EUR/USD as requested: "Permetti di scegliere tra euro e dollari. Di default deve essere euro")
 * - Time period defaults (Monthly as requested: "De default, l'orario è mensile")
 * - Other system preferences
 * 
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { SystemSetting } from '../types';
import { logger } from '../config/logger';

export class SystemSettingsService {
  constructor(private pool: Pool) {}

  /**
   * Get all system settings
   */
  async getAllSettings(): Promise<SystemSetting[]> {
    try {
      const [rows] = await this.pool.execute(
        'SELECT * FROM system_settings ORDER BY category, setting_key'
      );
      
      return (rows as any[]).map(row => ({
        id: row.id,
        key: row.setting_key,
        value: row.setting_value,
        description: row.description,
        category: row.category,
        dataType: row.data_type || 'string',
        isSystem: row.is_system === 1,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Error getting all settings:', error);
      throw error;
    }
  }

  /**
   * Get settings by category
   */
  async getSettingsByCategory(category: string): Promise<SystemSetting[]> {
    try {
      const [rows] = await this.pool.execute(
        'SELECT * FROM system_settings WHERE category = ? ORDER BY setting_key',
        [category]
      );
      
      return (rows as any[]).map(row => ({
        id: row.id,
        key: row.setting_key,
        value: row.setting_value,
        description: row.description,
        category: row.category,
        dataType: row.data_type || 'string',
        isSystem: row.is_system === 1,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      logger.error('Error getting settings by category:', error);
      throw error;
    }
  }

  /**
   * Get a specific setting value
   */
  async getSetting(category: string, settingKey: string): Promise<string | null> {
    try {
      const [rows] = await this.pool.execute(
        'SELECT setting_value FROM system_settings WHERE category = ? AND setting_key = ?',
        [category, settingKey]
      );
      
      const result = rows as any[];
      return result.length > 0 ? result[0].setting_value : null;
    } catch (error) {
      logger.error('Error getting setting:', error);
      throw error;
    }
  }

  /**
   * Update a setting value
   */
  async updateSetting(category: string, settingKey: string, value: string): Promise<boolean> {
    try {
      // Check if setting exists and is not system-protected
      const [checkRows] = await this.pool.execute(
        'SELECT is_system FROM system_settings WHERE category = ? AND setting_key = ?',
        [category, settingKey]
      );
      
      const checkResult = checkRows as any[];
      if (checkResult.length === 0) {
        throw new Error('Setting not found');
      }
      
      if (checkResult[0].is_system === 1) {
        throw new Error('System setting cannot be modified');
      }

      const [result] = await this.pool.execute(
        'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND setting_key = ?',
        [value, category, settingKey]
      );
      
      return (result as any).affectedRows > 0;
    } catch (error) {
      logger.error('Error updating setting:', error);
      throw error;
    }
  }

  /**
   * Reset a setting to its default value (remove custom value to use built-in default)
   */
  async resetSetting(category: string, settingKey: string): Promise<boolean> {
    try {
      // Get the default value from our predefined settings
      const defaults: Record<string, string> = {
        'general.currency': 'EUR',
        'schedule.default_time_period': 'monthly',
        'general.company_name': 'Staff Scheduler',
        'general.timezone': 'Europe/Rome',
        'general.date_format': 'DD/MM/YYYY',
        'general.time_format': '24h',
        'schedule.advance_notice_days': '14',
        'schedule.max_shift_hours': '12',
        'schedule.min_rest_hours': '11',
        'notifications.email_enabled': 'true',
        'notifications.sms_enabled': 'false'
      };
      
      const defaultValue = defaults[`${category}.${settingKey}`];
      if (!defaultValue) {
        throw new Error('Default value not found for setting');
      }

      const [result] = await this.pool.execute(
        'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND setting_key = ?',
        [defaultValue, category, settingKey]
      );
      
      return (result as any).affectedRows > 0;
    } catch (error) {
      logger.error('Error resetting setting:', error);
      throw error;
    }
  }

  /**
   * Get currency setting (EUR/USD as requested)
   */
  async getCurrency(): Promise<string> {
    const currency = await this.getSetting('general', 'currency');
    return currency || 'EUR'; // Default to EUR as requested
  }

  /**
   * Set currency setting
   */
  async setCurrency(currency: 'EUR' | 'USD'): Promise<boolean> {
    if (!['EUR', 'USD'].includes(currency)) {
      throw new Error('Invalid currency. Must be EUR or USD');
    }
    
    return await this.updateSetting('general', 'currency', currency);
  }

  /**
   * Get time period setting (Monthly default as requested)
   */
  async getTimePeriod(): Promise<string> {
    const timePeriod = await this.getSetting('schedule', 'default_time_period');
    return timePeriod || 'monthly'; // Default to monthly as requested
  }

  /**
   * Set time period setting
   */
  async setTimePeriod(period: 'daily' | 'weekly' | 'monthly' | 'yearly'): Promise<boolean> {
    const validPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!validPeriods.includes(period)) {
      throw new Error('Invalid time period');
    }
    
    return await this.updateSetting('schedule', 'default_time_period', period);
  }

}
