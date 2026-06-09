import pino from 'pino'

// Redact sensitive fields so secrets (ADMIN_TOKEN/token values) never appear in logs.
// The 'redact' option replaces matched paths with '[Redacted]'.
const REDACTED_PATHS = [
  'adminToken',
  'admin_token',
  'ADMIN_TOKEN',
  'token',
  'secret',
  'secret_hash',
  'bearer',
  'authorization',
  'password',
]

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: REDACTED_PATHS,
    censor: '[Redacted]',
  },
})

export default logger
