/**
 * System Settings Routes
 *
 * Handles system-wide configuration management including:
 * - Currency selection (EUR/USD as requested)
 * - Time period defaults (Monthly as requested)
 * - Other application settings
 *
 * Security:
 * - Only admin users can modify system settings
 * - All users can view settings for UI purposes
 *
 * @author Luca Ostinelli
 */

import { Router } from 'express';
import { Pool } from 'mysql2/promise';
import { SystemSettingsService } from '../services/SystemSettingsService';
import { authenticate, userHasPermission } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { updateCurrencyBody, updateTimePeriodBody, updateSettingValueBody, categoryParam, categoryKeyParam } from '../schemas';
import { logger } from '../config/logger';

export const createSystemSettingsRouter = (pool: Pool) => {
  const router = Router();
  const settingsService = new SystemSettingsService(pool);

  // Get all system settings
  router.get('/', authenticate, async (_req, res) => {
    try {
      const settings = await settingsService.getAllSettings();

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      logger.error('Get settings error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve settings' }
      });
    }
  });

  // Get settings by category
  router.get('/category/:category', authenticate, validateParams(categoryParam), async (_req, res) => {
    try {
      const { category } = res.locals.params;
      const settings = await settingsService.getSettingsByCategory(category);

      res.json({
        success: true,
        data: settings
      });
    } catch (error) {
      logger.error('Get settings by category error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve settings' }
      });
    }
  });

  // Get current currency
  router.get('/currency', authenticate, async (_req, res) => {
    try {
      const currency = await settingsService.getCurrency();
      res.json({
        success: true,
        data: { currency }
      });
    } catch (error) {
      logger.error('Get currency error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get currency setting' }
      });
    }
  });

  // Update currency (admin only)
  router.put('/currency', authenticate, validateBody(updateCurrencyBody), async (req, res) => {
    try {
      const user = req.user!;

      if (!userHasPermission(user, 'settings.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only administrators can change currency settings' }
        });
      }

      const { currency } = res.locals.body;

      await settingsService.setCurrency(currency);

      res.json({
        success: true,
        message: 'Currency updated successfully',
        data: { currency }
      });
    } catch (error) {
      logger.error('Set currency error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update currency' }
      });
    }
  });

  // Get current time period
  router.get('/time-period', authenticate, async (_req, res) => {
    try {
      const timePeriod = await settingsService.getTimePeriod();
      res.json({
        success: true,
        data: { timePeriod }
      });
    } catch (error) {
      logger.error('Get time period error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get time period setting' }
      });
    }
  });

  // Update time period (admin only)
  router.put('/time-period', authenticate, validateBody(updateTimePeriodBody), async (req, res) => {
    try {
      const user = req.user!;

      if (!userHasPermission(user, 'settings.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only administrators can change time period settings' }
        });
      }

      const { timePeriod } = res.locals.body;

      await settingsService.setTimePeriod(timePeriod);

      res.json({
        success: true,
        message: 'Time period updated successfully',
        data: { timePeriod }
      });
    } catch (error) {
      logger.error('Set time period error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update time period' }
      });
    }
  });

  // Get specific setting value
  router.get('/:category/:key', authenticate, validateParams(categoryKeyParam), async (_req, res) => {
    try {
      const { category, key } = res.locals.params;
      const value = await settingsService.getSetting(category, key);

      if (value === null) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Setting not found' }
        });
      }

      res.json({
        success: true,
        data: { category, key, value }
      });
    } catch (error) {
      logger.error('Get setting error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve setting' }
      });
    }
  });

  // Update setting value (admin only)
  router.put('/:category/:key', authenticate, validateParams(categoryKeyParam), validateBody(updateSettingValueBody), async (req, res) => {
    try {
      const user = req.user!;

      // Only admin can modify system settings
      if (!userHasPermission(user, 'settings.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only administrators can modify system settings' }
        });
      }

      const { category, key } = res.locals.params;
      const { value } = res.locals.body;

      // Validate specific settings
      if (category === 'general' && key === 'currency') {
        if (!['EUR', 'USD'].includes(value)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Currency must be EUR or USD' }
          });
        }
      }

      if (category === 'schedule' && key === 'default_time_period') {
        if (!['daily', 'weekly', 'monthly', 'yearly'].includes(value)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_INPUT', message: 'Time period must be daily, weekly, monthly, or yearly' }
          });
        }
      }

      const updated = await settingsService.updateSetting(category, key, value);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Setting not found' }
        });
      }

      res.json({
        success: true,
        message: 'Setting updated successfully',
        data: { category, key, value }
      });
    } catch (error: any) {
      logger.error('Update setting error:', error);

      if (error.message === 'System setting cannot be modified') {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This system setting cannot be modified' }
        });
      }

      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update setting' }
      });
    }
  });

  // Reset setting to default value (admin only)
  router.post('/:category/:key/reset', authenticate, validateParams(categoryKeyParam), async (req, res) => {
    try {
      const user = req.user!;

      // Only admin can reset system settings
      if (!userHasPermission(user, 'settings.manage')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only administrators can reset system settings' }
        });
      }

      const { category, key } = res.locals.params;
      const reset = await settingsService.resetSetting(category, key);

      if (!reset) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Setting not found' }
        });
      }

      res.json({
        success: true,
        message: 'Setting reset to default value successfully'
      });
    } catch (error) {
      logger.error('Reset setting error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to reset setting' }
      });
    }
  });

  return router;
};
