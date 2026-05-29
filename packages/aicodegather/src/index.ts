import { createLogger } from './logger'
import type { PreEditData } from './types'
import { calculateHash, computeDiff, readFileContent } from './diff'
import { FileFilter } from './file-filter'
import { getGitInfo, getGitRemoteUrl } from './git-ops'
import { reportCodeEdit, reportSessionStart } from './reporter'
import type {
	ExtensionAPI,
	ExtensionFactory,
} from './omp-types'

const log = createLogger('index')
const preEditCache = new Map<string, PreEditData>()

/**
 * Extract the file path from a tool_call event input.
 *
 * OMP's edit tool accepts 4 schema modes:
 * - replace/patch: `{ path: string, edits: [...] }`  → direct `path` field
 * - hashline:      `{ input: "¶path#hash\n..." }`    → parse hashline envelope
 * - apply-patch:   `{ input: "*** Add File: path" }`  → parse apply-patch envelope
 *
 * Write tool always has `{ path: string, content: string }`.
 */
export function extractFilePath(input: Record<string, unknown>): string | undefined {
	// Direct `path` field (replace/patch modes of edit, and write tool)
	const directPath = input['path']
	if (typeof directPath === 'string' && directPath)
		return directPath

	// Hashline / apply-patch modes: `input` is a raw string containing the path
	const rawInput = input['input']
	if (typeof rawInput !== 'string' || !rawInput)
		return undefined

	// Hashline: ¶path#hash or §path#hash or @path#hash
	const hashlineMatch = /^(?:¶|§|@)([^\s#]+)/m.exec(rawInput)
	if (hashlineMatch?.[1])
		return hashlineMatch[1]

	// Apply-patch: *** Add/Update/Delete File: path
	const applyPatchMatch = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/m.exec(rawInput)
	if (applyPatchMatch?.[1])
		return applyPatchMatch[1].trim()

	return undefined
}

/**
 * OMP Extension entry point.
 *
 * Events:
 *   session_start  → report session telemetry
 *   tool_call      → cache file content before edit/write
 *   tool_result    → compute diff and report after edit/write
 *
 * Only processes source files in gitlab.zhuanspirit.com repos.
 */
const aicodegather: ExtensionFactory = (pi: ExtensionAPI): void => {
	log.info('aicodegather extension loaded')

	pi.on('session_start', async (_event, ctx) => {
		log.info('==================================================')
		log.info('session_start 开始执行')
		log.info(`session start: cwd=${ctx.cwd}`)
		await reportSessionStart(ctx.cwd)
		log.info('session_start 执行完成')
	})

	pi.on('tool_call', async (event) => {
		if (event.toolName !== 'edit' && event.toolName !== 'write')
			return

		log.info('==================================================')
		log.info('pre_edit 开始执行')

		const filePath = extractFilePath(event.input)
		if (!filePath) {
			log.error(`未找到file_path, input keys=${Object.keys(event.input).join(',')}`)
			return
		}

		log.info(`处理文件: ${filePath}`)

		// Guard: 只处理 gitlab.zhuanspirit.com 的仓库
		const remoteUrl = getGitRemoteUrl(filePath)
		log.debug(`Git远程URL: ${remoteUrl}`)
		if (!remoteUrl?.includes('gitlab.zhuanspirit.com')) {
			log.info(`跳过: 非gitlab.zhuanspirit.com仓库, remote_url=${remoteUrl}`)
			return
		}

		// 过滤文件
		if (!FileFilter.shouldProcess(filePath)) {
			log.info(`跳过: 文件不在过滤范围内, file_path=${filePath}`)
			return
		}

		// 读取文件内容
		const content = readFileContent(filePath)
		log.debug(`读取文件内容: length=${content.length}, file_path=${filePath}`)

		// 获取 Git 信息
		const gitInfo = getGitInfo(filePath)
		log.debug(`Git信息: ${JSON.stringify(gitInfo)}`)

		// 获取相对路径
		const relativePath = gitInfo.namespace
			? filePath.replace(/^.*?(?=packages\/|src\/)/, '')
			: filePath
		log.debug(`相对路径: ${relativePath}`)

		log.info(`pre-edit cached: ${filePath} (${content.length} chars)`)
		preEditCache.set(filePath, {
			content,
			gitInfo,
			relativePath,
			timestamp: Date.now(),
		})

		log.info('pre_edit 执行完成')
	})

	pi.on('tool_result', async (event) => {
		if (event.toolName !== 'edit' && event.toolName !== 'write')
			return
		if (event.isError) {
			log.debug(`tool_result isError=true, toolName=${event.toolName}, 跳过`)
			return
		}

		log.info('==================================================')
		log.info('post_edit 开始执行')

		const filePath = extractFilePath(event.input)
		if (!filePath) {
			log.error(`未找到file_path, input keys=${Object.keys(event.input).join(',')}`)
			return
		}

		log.info(`处理文件: ${filePath}`)

		// 过滤文件
		if (!FileFilter.shouldProcess(filePath)) {
			log.info('跳过: 文件不在过滤范围内')
			return
		}

		const preData = preEditCache.get(filePath)
		if (!preData) {
			log.error(`未找到pre_edit数据: ${filePath}`)
			return
		}
		preEditCache.delete(filePath)

		log.debug(`读取pre数据: filePath=${filePath}`)

		const afterContent = readFileContent(filePath)
		log.debug(`读取after内容: length=${afterContent.length}`)

		const diff = computeDiff(preData.content, afterContent)
		log.debug(`计算diff: diff_length=${diff?.length ?? 0}`)

		if (!diff) {
			log.info('diff为空，跳过')
			return
		}

		log.info(`post-edit diff: ${filePath} (${diff.length} chars)`)

		const codeItem = {
			namespace: preData.gitInfo.namespace,
			branchName: preData.gitInfo.branch,
			gitName: preData.gitInfo.user,
			code: diff,
			filePath: preData.relativePath,
			hash: calculateHash(diff),
			env: preData.gitInfo.env,
			source: 'omp-extension',
			aiType: 2,
		}
		log.debug(`组装数据: ${JSON.stringify(codeItem)}`)

		await reportCodeEdit(codeItem)

		log.info('post_edit 执行完成')
	})
}

export default aicodegather
