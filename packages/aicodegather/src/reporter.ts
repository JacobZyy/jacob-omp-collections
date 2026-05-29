import type { CodeEditItem, CodeEditPayload, SessionBackup, SessionStartPayload } from './types'
import { CODE_REPORT_ENDPOINT, MAX_RETRIES, REQUEST_TIMEOUT_MS, RETRY_INTERVAL_MS, SESSION_REPORT_ENDPOINT, VERSION } from './config'
import { getEnvType, getGitRemoteUrl, getGitRoot, getGitUser } from './git-ops'
import { createLogger, createRetryLogger } from './logger'

const log = createLogger('reporter')
const retryLog = createRetryLogger('reporter')

/** fetch with abort-timeout */
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

/** In-memory retry queue */
interface RetryTask {
	url: string
	body: unknown
	remaining: number
	timer: ReturnType<typeof setTimeout> | null
}

const retryQueue: RetryTask[] = []

function scheduleRetry(task: RetryTask): void {
	if (task.remaining <= 0)
		return
	task.timer = setTimeout(async () => {
		retryQueue.splice(retryQueue.indexOf(task), 1)
		const ok = await fetchWithTimeout(task.url, task.body)
		if (!ok) {
			task.remaining--
			retryLog.warn(`retry failed (${task.remaining} left): ${task.url}`)
			scheduleRetry(task)
		}
		else {
			retryLog.info(`retry ok: ${task.url}`)
		}
	}, RETRY_INTERVAL_MS)
}

function enqueueRetry(url: string, body: unknown): void {
	const task: RetryTask = { url, body, remaining: MAX_RETRIES, timer: null }
	retryQueue.push(task)
	retryLog.warn(`enqueued retry: ${url}`)
	scheduleRetry(task)
}

/** Report a code edit */
export async function reportCodeEdit(item: CodeEditItem): Promise<void> {
	const payload: CodeEditPayload = { codeList: [item] }
	log.info(`reporting code edit: ${item.filePath} (${item.hash})`)
	const ok = await fetchWithTimeout(CODE_REPORT_ENDPOINT, payload)
	if (!ok) {
		log.error(`report code edit failed: ${item.filePath}`)
		enqueueRetry(CODE_REPORT_ENDPOINT, payload)
	}
	else {
		log.info(`report code edit ok: ${item.filePath}`)
	}
}

/** Report session start telemetry */
export async function reportSessionStart(cwd: string): Promise<void> {
	const root = getGitRoot(cwd) ?? cwd
	const remoteUrl = getGitRemoteUrl(root) ?? ''

	// Only report gitlab.zhuanspirit.com repos
	if (!remoteUrl.includes('gitlab.zhuanspirit.com')) {
		log.debug(`skip session start: not gitlab repo (${remoteUrl || 'no remote'})`)
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
	const ok = await fetchWithTimeout(SESSION_REPORT_ENDPOINT, payload)
	if (!ok) {
		log.error('report session start failed')
		enqueueRetry(SESSION_REPORT_ENDPOINT, payload)
	}
	else {
		log.info('report session start ok')
	}
}
