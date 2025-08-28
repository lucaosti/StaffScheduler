/**
 * Staff Scheduler Backend Application
 * 
 * Enterprise-grade workforce management system built with Node.js, Express, and TypeScript.
 * Provides RESTful APIs for employee scheduling, shift management, and optimization algorithms.
 * 
 * Key Features:
 * - JWT-based authentication with role-based access control
 * - Advanced schedule optimization using constraint programming
 * - Hierarchical organization management with delegation support
 * - Real-time conflict detection and validation
 * - Comprehensive audit trails and logging
 * 
 * Security Features:
 * - Rate limiting and CORS protection
 * - Request validation and sanitization
 * - Secure password hashing with bcrypt
 * - Helmet security headers
 * 
 * @author Luca Ostinelli
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './config/logger';
import { database } from './config/database';

// Import API route modules
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import employeeRoutes from './routes/employees';
import shiftRoutes from './routes/shifts';
import assignmentRoutes from './routes/assignments';
import scheduleRoutes from './routes/schedules';
import dashboardRoutes from './routes/dashboard';
import healthRoutes from './routes/health';

// Initialize Express application
const app = express();

/**
 * Security Middleware Configuration
 * 
 * Helmet provides security headers to protect against common vulnerabilities:
 * - XSS protection
 * - Content type sniffing protection
 * - Click-jacking protection
 * - HSTS headers for HTTPS
 */
app.use(helmet());

/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 * 
 * Allows controlled access from frontend applications while maintaining security.
 * Configuration is environment-specific through config files.
 */
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
}));

/**
 * Rate Limiting Configuration
 * 
 * Prevents abuse and DOS attacks by limiting requests per IP address.
 * Applied to all API routes to ensure system stability.
 * 
 * Default: 100 requests per 15 minutes per IP
 */
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindow,
  max: config.security.rateLimitMax,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.'
    }
  }
});
app.use('/api/', limiter);

/**
 * General Middleware Configuration
 * 
 * - Compression: Gzip compression for better performance
 * - JSON Parser: Parse JSON request bodies with size limit
 * - URL Encoded: Parse URL-encoded request bodies
 */
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * Request Logging Configuration
 * 
 * Uses Morgan HTTP request logger to track API usage and debug issues.
 * Integrates with Winston logger for consistent log formatting.
 * Disabled in test environment to reduce noise.
 */
if (config.server.env !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message: string) => logger.info(message.trim())
    }
  }));
}

/**
 * Health Check Endpoint
 * 
 * Provides basic service status for load balancers and monitoring systems.
 * Returns current timestamp and environment information.
 * 
 * @route GET /health
 * @returns {Object} Service status and environment info
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Staff Scheduler API is running',
    timestamp: new Date().toISOString(),
    environment: config.server.env
  });
});

/**
 * API Route Registration
 * 
 * All API endpoints are prefixed with /api for clear separation from static content.
 * Routes are organized by functional domain for maintainability.
 * 
 * Authentication: JWT-based with role-based access control
 * Authorization: Hierarchical permissions with delegation support
 */
app.use('/api/auth', authRoutes);           // Authentication and token management
app.use('/api/users', userRoutes);          // User management and profiles
app.use('/api/employees', employeeRoutes);  // Employee data and operations
app.use('/api/shifts', shiftRoutes);        // Shift definitions and templates
app.use('/api/assignments', assignmentRoutes); // Shift assignments and scheduling
app.use('/api/schedules', scheduleRoutes);  // Schedule generation and optimization
app.use('/api/dashboard', dashboardRoutes); // Analytics and reporting
app.use('/api', healthRoutes);              // System health and diagnostics

/**
 * 404 Error Handler
 * 
 * Catches all unmatched routes and returns consistent error format.
 * Provides helpful error codes for API consumers.
 */
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

/**
 * Global Error Handler
 * 
 * Catches unhandled errors and provides consistent error responses.
 * Includes detailed error information in development, sanitized in production.
 * Logs all errors for debugging and monitoring purposes.
 * 
 * @param error - The error object
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: config.server.env === 'production' 
        ? 'Internal server error' 
        : error.message || 'Something went wrong'
    }
  });
});

/**
 * Server Startup Configuration
 * 
 * Initializes database connection and starts the Express server.
 * Includes graceful error handling and proper logging.
 */
const PORT = config.server.port;

/**
 * Server Initialization Function
 * 
 * Performs startup checks and begins accepting requests.
 * Tests database connectivity before starting the HTTP server.
 * 
 * @returns {Promise<void>} Resolves when server is ready
 */
const startServer = async () => {
  try {
    // Test database connection
    await database.testConnection();
    logger.info('Database connection established successfully');

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`🚀 Staff Scheduler API server running on port ${PORT}`);
      logger.info(`📊 Environment: ${config.server.env}`);
      logger.info(`🔒 CORS enabled for: ${config.cors.origin}`);
      logger.info(`📡 API endpoints available at: http://localhost:${PORT}/api`);
      logger.info(`❤️  Health check available at: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

/**
 * Graceful Shutdown Handler
 * 
 * Handles SIGTERM and SIGINT signals for clean application shutdown.
 * Ensures database connections are properly closed.
 */
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await database.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await database.close();
  process.exit(0);
});

/**
 * Unhandled Rejection Handler
 * 
 * Catches unhandled promise rejections and logs them appropriately.
 * Prevents silent failures in async operations.
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
  process.exit(1);
});

// Initialize and start the server
startServer();

export default app;
