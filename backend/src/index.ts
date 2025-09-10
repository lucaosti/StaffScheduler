import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createPool } from 'mysql2/promise';
import config from './config';
import logger from './config/logger';

// Import routes
import { createAuthRouter } from './routes/auth';
import { createUsersRouter } from './routes/users';
import dashboardRoutes from './routes/dashboard';
import { createEmployeesRouter } from './routes/employees';
import { createShiftsRouter } from './routes/shifts';
import { createSchedulesRouter } from './routes/schedules';
import { createAssignmentsRouter } from './routes/assignments';
import { createSystemSettingsRouter } from './routes/settings';
import healthRoutes from './routes/health';

async function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet());

  // CORS configuration
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      // In development, allow localhost on any port
      if (config.server.env === 'development' && origin.includes('localhost')) {
        return callback(null, true);
      }
      
      // Allow the configured origin
      if (origin === config.cors.origin) {
        return callback(null, true);
      }
      
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
  });
  app.use(limiter);

  // Compression
  app.use(compression());

  // Request logging
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) }
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Create database connection pool
  const pool = createPool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  logger.info('Database connection established');

  // Test database connection
  try {
    await pool.execute('SELECT 1');
    logger.info('Database connection test successful');
  } catch (error) {
    logger.error('Database connection test failed:', error);
    process.exit(1);
  }

  // Routes with database pool injection
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', createAuthRouter(pool));
  app.use('/api/users', createUsersRouter(pool));
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/employees', createEmployeesRouter(pool));
  app.use('/api/shifts', createShiftsRouter(pool));
  app.use('/api/schedules', createSchedulesRouter(pool));
  app.use('/api/assignments', createAssignmentsRouter(pool));
  app.use('/api/settings', createSystemSettingsRouter(pool));

  // Error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error:', err);
    
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' 
          ? 'An internal error occurred' 
          : err.message
      }
    });
  });

  // 404 handler
  app.use('*', (req: express.Request, res: express.Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found'
      }
    });
  });

  return app;
}

async function startServer() {
  try {
    const app = await createApp();
    const port = config.server.port;

    app.listen(port, () => {
      logger.info(`🚀 Staff Scheduler API server is running on port ${port}`);
      logger.info(`📊 Health check: http://localhost:${port}/api/health`);
      logger.info(`🔑 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  logger.error('Fatal error starting server:', error);
  process.exit(1);
});
