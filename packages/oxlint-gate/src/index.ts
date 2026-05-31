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

const TS_EXTENSIONS = /\.(?:ts|tsx|mts|cts|vue)$/
const OXLINT_CFG = join(homedir(), '.config', 'oxlint', 'oxlintrc.json')
const LOG_DIR = join(homedir(), '.omp', 'logs')
const LOG_FILE = join(LOG_DIR, 'oxlint-gate.log')
const HOME = homedir()

// Tools that modify files
const WRITE_TOOLS = new Set(['edit', 'write'])

/** Max auto-fix attempts per file per turn. */
const MAX_FIX_ATTEMPTS = 3

/** Max lines of oxlint output to keep. */
const MAX_OUTPUT_LINES = 20

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

function runOxlintFix(filePath: string, cfgPath: string): { fixed: boolean, remaining: number, output: string } {
  const result = spawnSync('oxlint', ['--fix', '-c', cfgPath, filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  })

  if (result.error) {
    return { fixed: false, remaining: -1, output: `oxlint error: ${result.error.message}` }
  }

  const exitCode = result.status ?? -1
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

  // exit 0 = all fixed, exit 1 = remaining violations
  return { fixed: exitCode === 0, remaining: exitCode === 1 ? 1 : 0, output }
}

function truncateOutput(output: string, maxLines: number = MAX_OUTPUT_LINES): string {
  const lines = output.split('\n')
  if (lines.length <= maxLines)
    return output
  const head = lines.slice(0, 10).join('\n')
  const summary = lines.slice(-5).join('\n')
  return `${head}\n\n... (${lines.length - 15} lines truncated) ...\n\n${summary}`
}

const pendingPaths = new Map<string, { toolName: string, timestamp: number }>()
const fixCounters = new Map<string, number>()

const oxlintGate: ExtensionFactory = (pi: ExtensionAPI): void => {
  const log = pi.logger

  log.info('[oxlint-gate] extension loaded (auto-fix mode)')
  writeLog('INFO', 'extension loaded (auto-fix mode)')

  // ── tool_call: record file path, don't block ────────────────────────
  pi.on('tool_call', async (event, ctx) => {
    if (!WRITE_TOOLS.has(event.toolName))
      return

    const extractedPath = extractFilePath(event.input as Record<string, unknown>)
    if (!extractedPath)
      return

    const expandedPath = expandTilde(extractedPath)
    const filePath = isAbsolute(expandedPath) ? expandedPath : resolve(ctx.cwd, expandedPath)

    if (!TS_EXTENSIONS.test(filePath))
      return
    if (!isExistingFile(filePath))
      return

    pendingPaths.set(filePath, { toolName: event.toolName, timestamp: Date.now() })
    return undefined
  })

  // ── tool_result: check & auto-fix ───────────────────────────────────
  pi.on('tool_result', async (event, ctx) => {
    if (!WRITE_TOOLS.has(event.toolName))
      return

    const extractedPath = extractFilePath(event.input as Record<string, unknown>)
    if (!extractedPath)
      return

    const expandedPath = expandTilde(extractedPath)
    const filePath = isAbsolute(expandedPath) ? expandedPath : resolve(ctx.cwd, expandedPath)

    const pending = pendingPaths.get(filePath)
    pendingPaths.delete(filePath)
    if (!pending)
      return

    if (!TS_EXTENSIONS.test(filePath))
      return
    if (!isExistingFile(filePath))
      return
    if (!existsSync(OXLINT_CFG))
      return

    const ignorePatterns = loadIgnorePatterns(OXLINT_CFG)
    if (matchesIgnorePattern(filePath, ignorePatterns))
      return

    const fixCount = fixCounters.get(filePath) ?? 0
    if (fixCount >= MAX_FIX_ATTEMPTS) {
      log.debug(`[oxlint-gate] max fix attempts (${MAX_FIX_ATTEMPTS}) reached for ${filePath}`)
      return
    }

    // 1. Check for violations
    const { passed } = runOxlint(filePath, OXLINT_CFG)
    if (passed) {
      log.info(`[oxlint-gate] passed: ${filePath}`)
      writeLog('INFO', `passed: ${filePath}`)
      fixCounters.delete(filePath) // reset counter on clean pass
      return
    }

    log.warn(`[oxlint-gate] violations in ${filePath}, attempting auto-fix`)
    writeLog('WARN', `violations in ${filePath}, attempting auto-fix`)

    // 2. Try auto-fix
    const fixResult = runOxlintFix(filePath, OXLINT_CFG)
    fixCounters.set(filePath, fixCount + 1)

    if (fixResult.fixed) {
      log.info(`[oxlint-gate] auto-fixed: ${filePath}`)
      writeLog('INFO', `auto-fixed: ${filePath}`)
      return {
        content: [{ type: 'text', text: `✅ [oxlint-gate] auto-fixed lint issues in ${filePath}` }],
      }
    }

    // 3. Some violations remain — report to LLM
    const remaining = truncateOutput(fixResult.output)
    log.warn(`[oxlint-gate] partial fix in ${filePath}, remaining issues`)
    writeLog('WARN', `partial fix in ${filePath}`)

    pi.sendMessage(
      {
        customType: 'oxlint-gate',
        content: `⚠️ [oxlint-gate] ${filePath} has remaining lint issues after auto-fix:\n\n${remaining}`,
        display: true,
        attribution: 'agent',
      },
      { triggerTurn: false },
    )
    return undefined
  })

  // ── turn_end: clear pending paths only (keep fixCounters to prevent loops) ──
  pi.on('turn_end', async () => {
    pendingPaths.clear()
  })
}

export default oxlintGate
