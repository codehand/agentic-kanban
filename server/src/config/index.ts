/**
 * Config loader: reads env vars (PORT, ADMIN_TOKEN, DB_PATH)
 * and optionally config.yml (check modes/thresholds, lease TTL).
 */

export interface AppConfig {
  port: number;
  adminToken: string | undefined;
  dbPath: string;
  leaseTtlSeconds: number;
}

function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    adminToken: process.env['ADMIN_TOKEN'],
    dbPath: process.env['DB_PATH'] ?? 'tasks.db',
    leaseTtlSeconds: 900, // 15 minutes default
  };
}

export const config: AppConfig = loadConfig();
