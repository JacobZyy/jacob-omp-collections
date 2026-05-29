/**
 * OMP Integration Simulation Test
 *
 * Simulates the exact call chain that OMP runtime uses:
 * 1. ConcreteExtensionAPI.on() stores handlers in extension.handlers Map
 * 2. ExtensionRunner.emitToolCall() iterates extensions and calls handlers
 * 3. ExtensionRunner.emitToolResult() iterates extensions and calls handlers
 *
 * This test does NOT import any OMP code — it replicates the minimal
 * runtime behavior in-process to verify the plugin's handlers work correctly.
 */
import { describe, expect, it, vi } from 'vitest'

// ── Replicate OMP's handler storage ──────────────────────────────────
type HandlerFn = (...args: unknown[]) => Promise<unknown>

interface SimulatedExtension {
	path: string
	handlers: Map<string, HandlerFn[]>
}

// ── Replicate OMP's ConcreteExtensionAPI.on() ────────────────────────
function createMockExtensionAPI(extension: SimulatedExtension) {
	return {
		on(event: string, handler: HandlerFn): void {
			const list = extension.handlers.get(event) ?? []
			list.push(handler)
			extension.handlers.set(event, list)
		},
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	}
}

// ── Replicate OMP's ExtensionRunner.emitToolCall() ────────────────────
async function emitToolCall(
	extensions: SimulatedExtension[],
	event: { type: 'tool_call'; toolName: string; toolCallId: string; input: Record<string, unknown> },
	ctx: { cwd: string },
): Promise<{ block?: boolean; reason?: string } | undefined> {
	for (const ext of extensions) {
		const handlers = ext.handlers.get('tool_call')
		if (!handlers || handlers.length === 0) continue

		for (const handler of handlers) {
			const handlerResult = await handler(event, ctx)
			if (handlerResult && typeof handlerResult === 'object' && 'block' in handlerResult) {
				return handlerResult as { block: boolean; reason?: string }
			}
		}
	}
	return undefined
}

// ── Replicate OMP's ExtensionRunner.emitToolResult() ──────────────────
async function emitToolResult(
	extensions: SimulatedExtension[],
	event: { type: 'tool_result'; toolName: string; toolCallId: string; input: Record<string, unknown>; content: unknown[]; isError: boolean },
	ctx: { cwd: string },
): Promise<void> {
	for (const ext of extensions) {
		const handlers = ext.handlers.get('tool_result')
		if (!handlers || handlers.length === 0) continue

		for (const handler of handlers) {
			await handler(event, ctx)
		}
	}
}

// ── Replicate OMP's ExtensionRunner.emit() for session_start ──────────
async function emit(
	extensions: SimulatedExtension[],
	event: { type: string },
	ctx: { cwd: string },
): Promise<void> {
	for (const ext of extensions) {
		const handlers = ext.handlers.get(event.type)
		if (!handlers || handlers.length === 0) continue

		for (const handler of handlers) {
			await handler(event, ctx)
		}
	}
}

// ── Import the plugin factory ────────────────────────────────────────
// We import the default export (the factory function)
// The factory receives `pi` (ExtensionAPI) and registers handlers via pi.on()

describe('OMP Integration: handler registration and invocation', () => {
	async function loadExtension() {
		// Dynamic import to get a fresh module each time
		const mod = await import('./index.ts')
		const factory = mod.default

		const extension: SimulatedExtension = {
			path: 'aicodegather',
			handlers: new Map(),
		}

		const api = createMockExtensionAPI(extension)

		// This is what OMP's loadExtension() does: call the factory
		await factory(api)

		return { extension, api, factory }
	}

	it('factory is a function', async () => {
		const mod = await import('./index.ts')
		expect(typeof mod.default).toBe('function')
	})

	it('registers handlers for session_start, tool_call, and tool_result', async () => {
		const { extension } = await loadExtension()

		expect(extension.handlers.has('session_start')).toBe(true)
		expect(extension.handlers.has('tool_call')).toBe(true)
		expect(extension.handlers.has('tool_result')).toBe(true)

		expect(extension.handlers.get('session_start')!.length).toBe(1)
		expect(extension.handlers.get('tool_call')!.length).toBe(1)
		expect(extension.handlers.get('tool_result')!.length).toBe(1)
	})

	it('session_start handler runs without error', async () => {
		const { extension } = await loadExtension()

		// Should not throw
		await emit([extension], { type: 'session_start' }, { cwd: '/tmp/test-project' })
	})

	it('tool_call handler is invoked for edit tool', async () => {
		const { extension } = await loadExtension()

		// Simulate what ExtensionToolWrapper.execute() does:
		// It constructs the event object with the tool's params as `input`
		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'edit',
			toolCallId: 'call-123',
			// This is the actual params the edit tool receives
			input: {
				path: '/tmp/test-project/src/foo.ts',
				edits: [{ oldText: 'hello', newText: 'world' }],
			},
		}

		// Should not throw — the handler will try getGitRemoteUrl, readFileContent etc.
		// which may fail on non-existent files, but should be caught
		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/tmp/test-project' })

		// Plugin should NOT block the tool
		expect(result?.block).toBeFalsy()
	})

	it('tool_call handler is invoked for write tool', async () => {
		const { extension } = await loadExtension()

		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'write',
			toolCallId: 'call-456',
			input: {
				path: '/tmp/test-project/src/bar.ts',
				content: 'const x = 1',
			},
		}

		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/tmp/test-project' })
		expect(result?.block).toBeFalsy()
	})

	it('tool_call handler ignores non-edit/write tools', async () => {
		const { extension } = await loadExtension()

		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'bash',
			toolCallId: 'call-789',
			input: { command: 'ls -la' },
		}

		// Should return undefined (no blocking)
		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/tmp/test-project' })
		expect(result).toBeUndefined()
	})

	it('tool_call handler extracts filePath from patch mode input', async () => {
		const { extension } = await loadExtension()

		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'edit',
			toolCallId: 'call-patch',
			input: {
				path: '/tmp/test-project/src/foo.ts',
				edits: [],
			},
		}

		// Handler should run (it will try git ops and fail silently for non-git dirs)
		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/tmp/test-project' })
		expect(result?.block).toBeFalsy()
	})

	it('tool_call handler extracts filePath from hashline mode input', async () => {
		const { extension } = await loadExtension()

		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'edit',
			toolCallId: 'call-hashline',
			input: {
				input: '¶/tmp/test-project/src/foo.ts#abc\n1 1\n+new line',
			},
		}

		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/tmp/test-project' })
		expect(result?.block).toBeFalsy()
	})

	it('tool_call handler resolves relative path using ctx.cwd', async () => {
		const { extension } = await loadExtension()

		// OMP sometimes passes relative paths like "src/api/foo.ts" instead of absolute
		const toolCallEvent = {
			type: 'tool_call' as const,
			toolName: 'edit',
			toolCallId: 'call-rel',
			input: {
				path: 'src/api/newStandard/publishParamsSelect.ts',
				edits: [],
			},
		}

		// Should not throw — handler resolves relative path with ctx.cwd
		const result = await emitToolCall([extension], toolCallEvent, { cwd: '/Users/test/project' })
		expect(result?.block).toBeFalsy()
	})

	it('tool_result handler is invoked without error', async () => {
		const { extension } = await loadExtension()

		const toolResultEvent = {
			type: 'tool_result' as const,
			toolName: 'edit',
			toolCallId: 'call-123',
			input: {
				path: '/tmp/test-project/src/foo.ts',
				edits: [],
			},
			content: [{ type: 'text', text: 'File edited successfully' }],
			isError: false,
		}

		// Should not throw (will not find pre-edit cache, so logs error and returns)
		await emitToolResult([extension], toolResultEvent, { cwd: '/tmp/test-project' })
	})

	it('tool_result handler skips on error', async () => {
		const { extension } = await loadExtension()

		const toolResultEvent = {
			type: 'tool_result' as const,
			toolName: 'edit',
			toolCallId: 'call-err',
			input: { path: '/tmp/test-project/src/foo.ts' },
			content: [{ type: 'text', text: 'Error occurred' }],
			isError: true,
		}

		// Should not throw
		await emitToolResult([extension], toolResultEvent, { cwd: '/tmp/test-project' })
	})

	it('hasHandlers returns true for tool_call after loading', async () => {
		const { extension } = await loadExtension()

		// Simulate hasHandlers check from ExtensionToolWrapper
		let hasToolCallHandlers = false
		for (const ext of [extension]) {
			const handlers = ext.handlers.get('tool_call')
			if (handlers && handlers.length > 0) {
				hasToolCallHandlers = true
				break
			}
		}
		expect(hasToolCallHandlers).toBe(true)

		let hasToolResultHandlers = false
		for (const ext of [extension]) {
			const handlers = ext.handlers.get('tool_result')
			if (handlers && handlers.length > 0) {
				hasToolResultHandlers = true
				break
			}
		}
		expect(hasToolResultHandlers).toBe(true)
	})
})

describe('OMP Integration: export default shape', () => {
	it('export default is a function (not an object with .default)', async () => {
		const mod = await import('./index.ts')
		// OMP's getExtensionFactory checks:
		//   typeof module === "function" ? module : module.default
		// Then checks: typeof candidate === "function"
		const candidate = typeof mod === 'function' ? mod : mod.default
		expect(typeof candidate).toBe('function')
	})

	it('factory returns void (synchronous)', async () => {
		const mod = await import('./index.ts')
		const extension: SimulatedExtension = {
			path: 'test',
			handlers: new Map(),
		}
		const api = createMockExtensionAPI(extension)
		const result = mod.default(api)
		// Factory should return void, not a Promise
		expect(result).toBeUndefined()
	})
})

describe('OMP Integration: real-world nlab_sale scenario', () => {
	// Simulates the exact OMP runtime call chain for the user's actual project
	const NLAB_SALE = '/Users/jacobzha/Documents/workspace/zhuanzhuan/nlab_sale'
	const REL_PATH = 'src/api/newStandard/publishParamsSelect.ts'
	const ABS_PATH = `${NLAB_SALE}/${REL_PATH}`

	async function loadExtension() {
		const mod = await import('./index.ts')
		const factory = mod.default
		const extension: SimulatedExtension = {
			path: 'aicodegather',
			handlers: new Map(),
		}
		const api = createMockExtensionAPI(extension)
		await factory(api)
		return { extension }
	}

	it('resolves relative path to absolute, finds git remote, and caches correctly', async () => {
		const { extension } = await loadExtension()

		// 1. tool_call with relative path — OMP sometimes passes "src/..." instead of absolute
		await emitToolCall([extension], {
			type: 'tool_call',
			toolName: 'edit',
			toolCallId: 'call-1',
			input: { path: REL_PATH, edits: [] },
		}, { cwd: NLAB_SALE })

		// 2. tool_result with the same relative path — must find the cached pre-edit data
		// We need to capture the handler's behavior. Since the handler writes to hook.log,
		// we check the cache indirectly by verifying tool_result doesn't log "未找到pre_edit数据"
		//
		// Instead, let's verify via the handler's internal state by reading hook.log
		const { readFileSync } = await import('node:fs')
		const logContent = readFileSync('/tmp/aicodegather/logs/hook.log', 'utf-8')
		const recentLog = logContent.split('\n').slice(-30).join('\n')

		// The tool_call handler should have resolved the path and found the git remote
		// It logs: 处理文件: <absolute_path>
		expect(recentLog).toContain(`处理文件: ${ABS_PATH}`)

		// It should have found the git remote (not null)
		expect(recentLog).toContain('Git远程URL: git@gitlab.zhuanspirit.com')

		// It should NOT have skipped with "非gitlab"
		// (if it did, the remote URL was null/found wrong)
		// Note: the handler may skip for other valid reasons (file filter), so we just
		// verify the remote was found
	})

	it('tool_call + tool_result cache roundtrip with relative path', async () => {
		const { extension } = await loadExtension()

		// tool_call: cache file content
		await emitToolCall([extension], {
			type: 'tool_call',
			toolName: 'edit',
			toolCallId: 'call-rt-1',
			input: { path: REL_PATH, edits: [] },
		}, { cwd: NLAB_SALE })

		// tool_result: should find cached data and compute diff
		await emitToolResult([extension], {
			type: 'tool_result',
			toolName: 'edit',
			toolCallId: 'call-rt-1',
			input: { path: REL_PATH, edits: [] },
			content: [{ type: 'text', text: 'File edited successfully' }],
			isError: false,
		}, { cwd: NLAB_SALE })

		// Check log for the roundtrip
		const { readFileSync } = await import('node:fs')
		const logContent = readFileSync('/tmp/aicodegather/logs/hook.log', 'utf-8')
		const recentLog = logContent.split('\n').slice(-30).join('\n')

		// tool_result should have found the pre-edit cache (not "未找到pre_edit数据")
		// If the cache roundtrip worked, we'll see "post_edit 执行完成" or "计算diff"
		// If it failed, we'll see "未找到pre_edit数据"
		expect(recentLog).not.toContain(`未找到pre_edit数据: ${ABS_PATH}`)
	})
})