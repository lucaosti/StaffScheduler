import winston from 'winston';
import { config } from '../config';

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
