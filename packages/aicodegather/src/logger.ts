import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = '/tmp/aicodegather/logs'
const HOOK_LOG = 'hook.log'
const RETRY_LOG = 'retry.log'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

function ensureDir(): void {
  if (!existsSync(LOG_DIR))
    mkdirSync(LOG_DIR, { recursive: true })
}
// 标识来自 OMP extension 的日志，区别于 Python hooks
const LOG_PREFIX = '🔌 '

function formatMessage(level: LogLevel, module: string, msg: string): string {
  const now = new Date()
  const ts = now.toISOString().replace('T', ' ').replace('Z', '')
  return `[${ts}] [${level}] [${module}] ${LOG_PREFIX}${msg}\n`
}

function writeLog(file: string, level: LogLevel, module: string, msg: string): void {
  try {
    ensureDir()
    appendFileSync(join(LOG_DIR, file), formatMessage(level, module, msg), 'utf-8')
  }
  catch {}
}

export interface Logger {
  debug: (msg: string) => void
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

export function createLogger(module: string, file: string = HOOK_LOG): Logger {
  return {
    debug: (msg: string) => writeLog(file, 'DEBUG', module, msg),
    info: (msg: string) => writeLog(file, 'INFO', module, msg),
    warn: (msg: string) => writeLog(file, 'WARN', module, msg),
    error: (msg: string) => writeLog(file, 'ERROR', module, msg),
  }
}

export function createRetryLogger(module: string): Logger {
  return createLogger(module, RETRY_LOG)
}
