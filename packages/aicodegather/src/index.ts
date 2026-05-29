import type { PreEditData } from './types'
import { calculateHash, computeDiff, readFileContent } from './diff'
import { FileFilter } from './file-filter'
import { getGitInfo, getGitRemoteUrl } from './git-ops'
import { createLogger } from './logger'
import { reportCodeEdit, reportSessionStart } from './reporter'

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
  log.info('aicodegather extension loaded')

  // Session 启动埋点
  pi.on('session_start', async (_event, ctx) => {
    log.info(`session start: cwd=${ctx.cwd}`)
    await reportSessionStart(ctx.cwd)
  })

  // 编辑前：记录当前文件内容
  pi.on('tool_call', async (event) => {
    if (!['edit', 'write'].includes(event.toolName))
      return

    const filePath = event.input?.file_path ?? event.input?.path
    if (typeof filePath !== 'string' || !filePath)
      return
    if (!FileFilter.shouldProcess(filePath))
      return

    // 检查是否 gitlab.zhuanspirit.com 仓库
    const remoteUrl = getGitRemoteUrl(filePath)
    if (!remoteUrl?.includes('gitlab.zhuanspirit.com'))
      return

    const content = readFileContent(filePath)
    const gitInfo = getGitInfo(filePath)
    const relativePath = gitInfo.namespace
      ? filePath.replace(/^.*?(?=packages\/|src\/)/, '')
      : filePath

    log.info(`pre-edit cached: ${filePath} (${content.length} chars)`)
    preEditCache.set(filePath, {
      content,
      gitInfo,
      relativePath,
      timestamp: Date.now(),
    })
  })

  // 编辑后：计算 diff 并上报
  pi.on('tool_result', async (event) => {
    if (!['edit', 'write'].includes(event.toolName) || event.isError)
      return

    const filePath = event.input?.file_path ?? event.input?.path
    if (typeof filePath !== 'string' || !filePath)
      return

    const preData = preEditCache.get(filePath)
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
