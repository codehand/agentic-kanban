import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface CheckConfig {
  mode: 'optional' | 'required'
  threshold?: number
}

export interface AppConfig {
  port: number
  adminToken: string
  dbPath: string
  checks: {
    lint: CheckConfig
    coverage: CheckConfig
  }
  leaseTtlSeconds: number
  heartbeatIntervalSeconds: number
}

function loadYamlConfig(configPath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return (parseYaml(raw) as Record<string, unknown>) ?? {}
  } catch (err) {
    // Missing config.yml is not fatal — use defaults
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      throw new Error(`Failed to read config.yml at ${configPath}: ${e.message}`)
    }
    return {}
  }
}

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return val
}

export function loadConfig(configYmlPath?: string): AppConfig {
  // Env vars
  const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
  const ADMIN_TOKEN = process.env['ADMIN_TOKEN'] ?? ''
  const DB_PATH = process.env['DB_PATH'] ?? 'tasks.db'

  if (!ADMIN_TOKEN) {
    // Warn but don't crash — allows boot in test environments
    process.stderr.write('[config] WARN: ADMIN_TOKEN is not set; admin bootstrap will be skipped\n')
  }

  // File config (config.yml)
  const ymlPath = configYmlPath ?? resolve(process.cwd(), 'config.yml')
  const yml = loadYamlConfig(ymlPath)

  const checks = (yml['checks'] as Record<string, unknown> | undefined) ?? {}
  const lintCfg = (checks['lint'] as Record<string, unknown> | undefined) ?? {}
  const covCfg = (checks['coverage'] as Record<string, unknown> | undefined) ?? {}

  return {
    port: PORT,
    adminToken: ADMIN_TOKEN,
    dbPath: DB_PATH,
    checks: {
      lint: {
        mode: (lintCfg['mode'] as 'optional' | 'required') ?? 'optional',
      },
      coverage: {
        mode: (covCfg['mode'] as 'optional' | 'required') ?? 'optional',
        threshold: (covCfg['threshold'] as number | undefined) ?? 80,
      },
    },
    leaseTtlSeconds: (yml['lease_ttl_seconds'] as number | undefined) ?? 900,
    heartbeatIntervalSeconds: (yml['heartbeat_interval_seconds'] as number | undefined) ?? 300,
  }
}
