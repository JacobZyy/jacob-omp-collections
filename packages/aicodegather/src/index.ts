import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PreEditData } from './types'
import { calculateHash, computeDiff, readFileContent } from './diff'
import { FileFilter } from './file-filter'
import { getGitInfo, getGitRemoteUrl } from './git-ops'
import { createLogger } from './logger'
import { reportCodeEdit, reportSessionStart } from './reporter'

// ── 诊断辅助：无条件写日志到 /tmp/aicodegather/logs/hook.log ──────────
const DIAG_DIR = '/tmp/aicodegather/logs'
function diag(tag: string, msg: string): void {
  try {
    if (!existsSync(DIAG_DIR))
      mkdirSync(DIAG_DIR, { recursive: true })
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '')
    appendFileSync(join(DIAG_DIR, 'hook.log'), `[${ts}] [DIAG] [${tag}] ${msg}\n`, 'utf-8')
  }
  catch {}
}

// [DIAG] 模块顶层 — 如果看不到这行，说明 OMP 没有加载此文件
diag('module-top', 'aicodegather module evaluated (top-level)')

const log = createLogger('index')
const preEditCache = new Map<string, PreEditData>()

/**
 * OMP Extension 入口
 *
 * 事件映射：
 *   session_start  → 上报 session 埋点
 *   tool_call      → 记录编辑前文件内容
 *   tool_result    → 计算 diff 并上报
 *
 * 仅处理 gitlab.zhuanspirit.com 仓库下的源码文件。
 */
export default function aicodegather(pi: {
  on: ((event: 'session_start', handler: (event: unknown, ctx: { cwd: string }) => Promise<void>) => void) & ((event: 'tool_call', handler: (event: { toolName: string, input?: Record<string, unknown> }) => Promise<void>) => void) & ((event: 'tool_result', handler: (event: { toolName: string, input?: Record<string, unknown>, isError?: boolean }) => Promise<void>) => void)
}): void {
  diag('entry', `aicodegather() called, pi.on type=${typeof pi.on}`)
  log.info('aicodegather extension loaded')

  // Session 启动埋点
  pi.on('session_start', async (_event, ctx) => {
    diag('session_start', `fired, cwd=${ctx.cwd}`)
    log.info(`session start: cwd=${ctx.cwd}`)
    await reportSessionStart(ctx.cwd)
  })

  // 编辑前：记录当前文件内容
  pi.on('tool_call', async (event) => {
    diag('tool_call', `toolName=${event.toolName}`)

    if (!['edit', 'write'].includes(event.toolName))
      return

    const filePath = event.input?.file_path ?? event.input?.path as string | undefined
    diag('tool_call-path', `filePath=${filePath ?? 'undefined'}`)

    if (typeof filePath !== 'string' || !filePath)
      return

    const shouldProcess = FileFilter.shouldProcess(filePath)
    diag('tool_call-filter', `shouldProcess=${shouldProcess}, filePath=${filePath}`)
    if (!shouldProcess)
      return

    // 检查是否 gitlab.zhuanspirit.com 仓库
    const remoteUrl = getGitRemoteUrl(filePath)
    diag('tool_call-remote', `remoteUrl=${remoteUrl ?? 'undefined'}`)
    if (!remoteUrl?.includes('gitlab.zhuanspirit.com'))
      return

    const content = readFileContent(filePath)
    const gitInfo = getGitInfo(filePath)
    const relativePath = gitInfo.namespace
      ? filePath.replace(/^.*?(?=packages\/|src\/)/, '')
      : filePath

    log.info(`pre-edit cached: ${filePath} (${content.length} chars)`)
    diag('tool_call-cached', `pre-edit cached: ${filePath} (${content.length} chars)`)
    preEditCache.set(filePath, {
      content,
      gitInfo,
      relativePath,
      timestamp: Date.now(),
    })
  })

  // 编辑后：计算 diff 并上报
  pi.on('tool_result', async (event) => {
    diag('tool_result', `toolName=${event.toolName}, isError=${event.isError}`)

    if (!['edit', 'write'].includes(event.toolName) || event.isError)
      return

    const filePath = event.input?.file_path ?? event.input?.path as string | undefined
    if (typeof filePath !== 'string' || !filePath)
      return

    const preData = preEditCache.get(filePath)
    diag('tool_result-cache', `filePath=${filePath}, cacheHit=${!!preData}`)
    if (!preData)
      return
    preEditCache.delete(filePath)

    const afterContent = readFileContent(filePath)
    const diff = computeDiff(preData.content, afterContent)
    if (!diff) {
      log.debug(`no diff for: ${filePath}`)
      return
    }

    log.info(`post-edit diff: ${filePath} (${diff.length} chars)`)
    diag('tool_result-report', `reporting diff for ${filePath} (${diff.length} chars)`)
    await reportCodeEdit({
      namespace: preData.gitInfo.namespace,
      branchName: preData.gitInfo.branch,
      gitName: preData.gitInfo.user,
      code: diff,
      filePath: preData.relativePath,
      hash: calculateHash(diff),
      env: preData.gitInfo.env,
      source: 'claude-code-extension',
      aiType: 2,
    })
  })
}
