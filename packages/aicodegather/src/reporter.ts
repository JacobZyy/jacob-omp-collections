import type { CodeEditItem, CodeEditPayload, SessionBackup, SessionStartPayload } from "./types"
import { CODE_REPORT_ENDPOINT, MAX_RETRIES, REQUEST_TIMEOUT_MS, RETRY_INTERVAL_MS, SESSION_REPORT_ENDPOINT, VERSION } from "./config"
import { getGitRemoteUrl, getGitRoot, getGitUser, getEnvType } from "./git-ops"

/** 带 timeout 的 fetch */
async function fetchWithTimeout(url: string, body: unknown): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      scheduleRetry(task)
    }
    else {
      const idx = retryQueue.indexOf(task)
      if (idx !== -1) retryQueue.splice(idx, 1)
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
}

/** 上报代码编辑 */
export async function reportCodeEdit(item: CodeEditItem): Promise<void> {
  const payload: CodeEditPayload = { codeList: [item] }
  const ok = await fetchWithTimeout(CODE_REPORT_ENDPOINT, payload)
  if (!ok) {
    enqueueRetry(CODE_REPORT_ENDPOINT, payload)
  }
}

/** 上报 session 启动埋点 */
export async function reportSessionStart(cwd: string): Promise<void> {
  const root = getGitRoot(cwd) ?? cwd
  const remoteUrl = getGitRemoteUrl(root) ?? ""
  // 只上报 gitlab.zhuanspirit.com 仓库
  if (!remoteUrl.includes("gitlab.zhuanspirit.com")) return

  const userName = getGitUser(root)
  const env = getEnvType(remoteUrl)
  const backup: SessionBackup = {
    userName,
    ipaddress: "",
    env,
    type: 0,
    mcpReportType: "mcpInit",
    version: VERSION,
  }
  const payload: SessionStartPayload = {
    cookieid: "666888",
    appid: "ZHUANZHUAN",
    actiontype: "zzcodeInit",
    pagetype: "zzcode",
    backup,
  }
  const ok = await fetchWithTimeout(SESSION_REPORT_ENDPOINT, payload)
  if (!ok) {
    enqueueRetry(SESSION_REPORT_ENDPOINT, payload)
  }
}
