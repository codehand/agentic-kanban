/**
 * Structured logger via pino.
 * SECURITY: never pass token secrets to log calls.
 */
import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});
