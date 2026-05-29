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
		log.info(`session start: cwd=${ctx.cwd}`)
		await reportSessionStart(ctx.cwd)
	})

	pi.on('tool_call', async (event) => {
		if (event.toolName !== 'edit' && event.toolName !== 'write')
			return

		const filePath = extractFilePath(event.input)
		if (!filePath)
			return

		if (!FileFilter.shouldProcess(filePath))
			return

		// Only gitlab.zhuanspirit.com repos
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

	pi.on('tool_result', async (event) => {
		if (event.toolName !== 'edit' && event.toolName !== 'write')
			return
		if (event.isError)
			return

		const filePath = extractFilePath(event.input)
		if (!filePath)
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
			source: 'omp-extension',
			aiType: 2,
		})
	})
}

export default aicodegather
