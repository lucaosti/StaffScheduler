/**
 * Winston Logger Configuration for Staff Scheduler Backend
 * 
 * Provides centralized logging functionality with file rotation,
 * multiple transport options, and environment-specific formatting.
 * 
 * Features:
 * - File-based logging with rotation (10MB max, configurable files)
 * - Console logging for development environments
 * - JSON structured logging for production
 * - Error stack trace capture
 * - Timestamp and service metadata
 * - Configurable log levels
 * 
 * Configuration:
 * - Production: File logging only with JSON format
 * - Development: Both file and colorized console logging
 * - Log rotation prevents disk space issues
 * 
 * @author Luca Ostinelli
 */

import winston from 'winston';
import { config } from '../config';

/**
 * Main application logger instance with configured transports and formatting
 * 
 * Transport Configuration:
 * - File transport: Always enabled with rotation settings
 * - Console transport: Only enabled in non-production environments
 * 
 * Format Configuration:
 * - Timestamp: ISO format for all log entries
 * - Error handling: Stack traces captured for Error objects
 * - JSON: Structured logging for easier parsing
 * - Service metadata: Identifies logs from this service
 */
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'staff-scheduler-backend' },
  transports: [
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 1024 * 1024 * 10, // 10MB
      maxFiles: config.logging.maxFiles,
    }),
  ],
});

// If we're not in production, log to the console as well
if (config.server.env !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export { logger };
export default logger;
