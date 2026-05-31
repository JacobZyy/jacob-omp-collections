/**
 * oxlint-gate: Real-time type assertion gate for OMP.
 *
 * Intercepts Edit/Write tool calls and checks the target file with oxlint
 * before allowing the edit to proceed. Blocks if type laziness assertions
 * (e.g., `as any`, `as unknown as X`) are detected.
 *
 * Configuration: reads rules from `~/.config/oxlint/oxlintrc.json`
 * Logs: writes to `~/.omp/logs/oxlint-gate.log`
 */

import type { ExtensionAPI, ExtensionFactory } from './omp-types'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

// ── Constants ──────────────────────────────────────────────────────────────

const TS_EXTENSIONS = /\.(?:ts|tsx|mts|cts|vue)$/
const OXLINT_CFG = join(homedir(), '.config', 'oxlint', 'oxlintrc.json')
const LOG_DIR = join(homedir(), '.omp', 'logs')
const LOG_FILE = join(LOG_DIR, 'oxlint-gate.log')
const HOME = homedir()

// Tools that modify files
const WRITE_TOOLS = new Set(['edit', 'write'])

// ── Types ──────────────────────────────────────────────────────────────────

interface OxlintConfig {
  ignorePatterns?: string[]
}

// ── Local Logger ───────────────────────────────────────────────────────────

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function writeLog(level: 'INFO' | 'WARN' | 'DEBUG', msg: string): void {
  try {
    ensureLogDir()
    const ts = new Date().toISOString()
    appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`)
  }
  catch {
    // Silently ignore log write failures
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Expand ~ to home directory
 */
function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return join(HOME, p.slice(1))
  }
  return p
}

export function extractFilePath(input: Record<string, unknown>): string | undefined {
  // Direct `path` field (replace/patch modes of edit, and write tool)
  const directPath = input.path
  if (typeof directPath === 'string' && directPath)
    return directPath

  // Hashline / apply-patch modes: `input` is a raw string containing the path
  const rawInput = input.input
  if (typeof rawInput !== 'string' || !rawInput)
    return undefined

  // Hashline: ¶path#hash or §path#hash or @path#hash
  const hashlineMatch = /^[¶§@]([^\s#]+)/m.exec(rawInput)
  if (hashlineMatch?.[1])
    return hashlineMatch[1]

  // Apply-patch: *** Add/Update/Delete File: path
  const applyPatchMatch = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)/m.exec(rawInput)
  if (applyPatchMatch?.[1])
    return applyPatchMatch[1].trim()

  return undefined
}

function isExistingFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  }
  catch {
    return false
  }
}

function loadIgnorePatterns(cfgPath: string): string[] {
  try {
    const raw = readFileSync(cfgPath, 'utf8')
    const cfg = JSON.parse(raw) as OxlintConfig
    if (!Array.isArray(cfg.ignorePatterns))
      return []
    return cfg.ignorePatterns.filter((p): p is string => typeof p === 'string')
  }
  catch {
    return []
  }
}

function matchesIgnorePattern(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0)
    return false

  const rel = relative(process.cwd(), filePath)
  const candidates = [filePath, rel, `./${rel}`]

  // Simple glob matching without Bun.Glob (for Node.js compatibility)
  for (const pattern of patterns) {
    const regex = globToRegex(pattern)
    if (regex) {
      for (const c of candidates) {
        if (regex.test(c))
          return true
      }
    }
  }
  return false
}

function globToRegex(glob: string): RegExp | null {
  try {
    // Convert glob to regex
    const regexStr = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
      .replace(/\*\*/g, '{{DOUBLE_STAR}}') // Temporarily replace **
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/\?/g, '[^/]') // ? matches single char except /
      .replace(/\{\{DOUBLE_STAR\}\}/g, '.*') // ** matches everything

    return new RegExp(`^${regexStr}$`)
  }
  catch {
    return null
  }
}

function runOxlint(filePath: string, cfgPath: string): { passed: boolean, output: string } {
  const result = spawnSync('oxlint', ['-c', cfgPath, filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000, // 5 second timeout
  })

  if (result.error) {
    // oxlint not found or spawn error — treat as pass (fail-open)
    return { passed: true, output: `oxlint error: ${result.error.message}` }
  }

  const exitCode = result.status ?? -1
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

  // exit 0 = pass, exit 1 = violations found, other = tool error (fail-open)
  return { passed: exitCode !== 1, output }
}

// ── Extension Factory ──────────────────────────────────────────────────────

const oxlintGate: ExtensionFactory = (pi: ExtensionAPI): void => {
  const log = pi.logger

  log.info('oxlint-gate extension loaded')
  writeLog('INFO', 'extension loaded')

  // Check if oxlint config exists
  if (!existsSync(OXLINT_CFG)) {
    log.warn(`oxlint config not found at ${OXLINT_CFG}, extension will be inactive`)
    writeLog('WARN', `oxlint config not found at ${OXLINT_CFG}`)
  }

  pi.on('tool_call', async (event, ctx) => {
    // Only intercept write tools
    if (!WRITE_TOOLS.has(event.toolName))
      return

    // Extract file path
    const extractedPath = extractFilePath(event.input as Record<string, unknown>)
    if (!extractedPath)
      return

    // Expand ~ and resolve to absolute path
    const expandedPath = expandTilde(extractedPath)
    const filePath = isAbsolute(expandedPath) ? expandedPath : resolve(ctx.cwd, expandedPath)

    // Only check TS/Vue files
    if (!TS_EXTENSIONS.test(filePath)) {
      writeLog('DEBUG', `skip (not TS/Vue): ${filePath}`)
      return
    }

    // Only check existing files (new files don't have type assertions yet)
    if (!isExistingFile(filePath)) {
      writeLog('DEBUG', `skip (new file): ${filePath}`)
      return
    }

    // Check if oxlint config exists
    if (!existsSync(OXLINT_CFG)) {
      log.debug('oxlint config not found, skipping check')
      writeLog('DEBUG', `skip (no config): ${filePath}`)
      return
    }

    // Check ignore patterns
    const ignorePatterns = loadIgnorePatterns(OXLINT_CFG)
    if (matchesIgnorePattern(filePath, ignorePatterns)) {
      log.debug(`file matches ignore pattern, skipping: ${filePath}`)
      writeLog('DEBUG', `skip (ignore pattern): ${filePath}`)
      return
    }

    log.info(`checking file for type assertions: ${filePath}`)
    writeLog('INFO', `checking: ${filePath}`)

    // Run oxlint
    const { passed, output } = runOxlint(filePath, OXLINT_CFG)

    if (!passed) {
      log.warn(`type assertion violations found in ${filePath}`)
      writeLog('WARN', `BLOCKED: ${filePath}\n${output}`)

      // Extract error summary
      const errorLine = output.split('\n').reverse().find(l => /Found .* errors?\./.test(l))
      const summary = errorLine
        ? `❌ [oxlint-gate] 检测到类型偷懒断言 — ${errorLine}`
        : '❌ [oxlint-gate] 检测到类型偷懒断言'

      return {
        block: true,
        reason: [
          summary,
          '',
          output,
          '',
          '按 ts-type-discipline 协议处理：',
          '  1) 优先用泛型 / 条件类型 / 类型守卫消除断言，禁止 as any / as unknown as X',
          '  2) 类型体操无效 → 追溯并修复底层类型声明（接口/DTO/类型定义）',
          '  3) 若是后端接口少返回字段 → 用 AskUserQuestion 与用户确认方案',
        ].join('\n'),
      }
    }

    log.info(`type assertion check passed: ${filePath}`)
    writeLog('INFO', `passed: ${filePath}`)
    return undefined
  })
}

export default oxlintGate
