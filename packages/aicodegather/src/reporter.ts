import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeEditItem, CodeEditPayload, SessionBackup, SessionStartPayload } from './types'
import { CODE_REPORT_ENDPOINT, MAX_RETRIES, REQUEST_TIMEOUT_MS, RETRY_INTERVAL_MS, SESSION_REPORT_ENDPOINT, VERSION } from './config'
import { getEnvType, getGitRemoteUrl, getGitRoot, getGitUser } from './git-ops'
import { createLogger, createRetryLogger } from './logger'

// ── 诊断辅助 ──────────────────────────────────────────────────────────
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

const log = createLogger('reporter')
const retryLog = createRetryLogger('reporter')

/** 带 timeout 的 fetch */
async function fetchWithTimeout(url: string, body: unknown): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.ok
  }
  catch {
    return false
  }
}

/** 内存重试队列 */
interface RetryTask {
  url: string
  body: unknown
  remaining: number
  timer: ReturnType<typeof setTimeout> | null
}

const retryQueue: RetryTask[] = []

function scheduleRetry(task: RetryTask): void {
  task.timer = setTimeout(async () => {
    task.timer = null
    const ok = await fetchWithTimeout(task.url, task.body)
    if (!ok && task.remaining > 1) {
      task.remaining--
      retryLog.warn(`retry failed, remaining=${task.remaining}, url=${task.url}`)
      scheduleRetry(task)
    }
    else {
      if (ok)
        retryLog.info(`retry succeeded, url=${task.url}`)
      else
        retryLog.error(`retry exhausted, url=${task.url}`)
      const idx = retryQueue.indexOf(task)
      if (idx !== -1)
        retryQueue.splice(idx, 1)
    }
  }, RETRY_INTERVAL_MS)
}

function enqueueRetry(url: string, body: unknown): void {
  const task: RetryTask = {
    url,
    body,
    remaining: MAX_RETRIES,
    timer: null,
  }
  retryQueue.push(task)
  scheduleRetry(task)
  retryLog.warn(`enqueued retry, remaining=${MAX_RETRIES}, url=${url}`)
}

/** 上报代码编辑 */
export async function reportCodeEdit(item: CodeEditItem): Promise<void> {
  diag('reportCodeEdit', `filePath=${item.filePath}, hash=${item.hash}`)
  const payload: CodeEditPayload = { codeList: [item] }
  log.info(`reporting code edit: ${item.filePath} (${item.hash})`)
  const ok = await fetchWithTimeout(CODE_REPORT_ENDPOINT, payload)
  if (!ok) {
    log.error(`report code edit failed: ${item.filePath}`)
    diag('reportCodeEdit', `FAILED, enqueueing retry for ${item.filePath}`)
    enqueueRetry(CODE_REPORT_ENDPOINT, payload)
  }
  else {
    log.info(`report code edit ok: ${item.filePath}`)
    diag('reportCodeEdit', `OK for ${item.filePath}`)
  }
}

/** 上报 session 启动埋点 */
export async function reportSessionStart(cwd: string): Promise<void> {
  diag('reportSessionStart', `cwd=${cwd}`)
  const root = getGitRoot(cwd) ?? cwd
  const remoteUrl = getGitRemoteUrl(root) ?? ''
  diag('reportSessionStart', `root=${root}, remoteUrl=${remoteUrl || '(empty)'}`)

  // 只上报 gitlab.zhuanspirit.com 仓库
  if (!remoteUrl.includes('gitlab.zhuanspirit.com')) {
    log.debug(`skip session start: not gitlab repo (${remoteUrl || 'no remote'})`)
    diag('reportSessionStart', `SKIPPED: not gitlab repo (remoteUrl=${remoteUrl || 'no remote'})`)
    return
  }

  const userName = getGitUser(root)
  const env = getEnvType(remoteUrl)
  const backup: SessionBackup = {
    userName,
    ipaddress: '',
    env,
    type: 0,
    mcpReportType: 'mcpInit',
    version: VERSION,
  }
  const payload: SessionStartPayload = {
    cookieid: '666888',
    appid: 'ZHUANZHUAN',
    actiontype: 'zzcodeInit',
    pagetype: 'zzcode',
    backup,
  }
  log.info(`reporting session start: user=${userName}, env=${env}`)
  diag('reportSessionStart', `sending: user=${userName}, env=${env}`)
  const ok = await fetchWithTimeout(SESSION_REPORT_ENDPOINT, payload)
  if (!ok) {
    log.error('report session start failed')
    diag('reportSessionStart', 'FAILED, enqueueing retry')
    enqueueRetry(SESSION_REPORT_ENDPOINT, payload)
  }
  else {
    log.info('report session start ok')
    diag('reportSessionStart', 'OK')
  }
}
