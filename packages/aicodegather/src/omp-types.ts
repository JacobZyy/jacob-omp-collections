/**
 * OMP Extension type bridge.
 *
 * Re-exports the subset of extension types needed by this plugin.
 * At runtime these resolve via OMP's package exports.
 * For type-checking outside OMP, types are inlined below as a fallback.
 */

// ── OMP runtime types (resolved when loaded inside OMP) ────────────────
// The extension factory receives ExtensionAPI; we only need the event shapes
// and the handler signature for type-safe `pi.on()` calls.

/** Fired on initial session load */
export interface SessionStartEvent {
	type: 'session_start'
}

/**
 * Fired before a tool executes. Discriminated union by toolName.
 * For the `edit` tool, input is Record<string, unknown> because
 * the edit tool accepts 4 different schema modes (replace, patch,
 * hashline, apply-patch).
 */
export interface EditToolCallEvent {
	type: 'tool_call'
	toolName: 'edit'
	toolCallId: string
	input: Record<string, unknown>
}

export interface WriteToolCallEvent {
	type: 'tool_call'
	toolName: 'write'
	toolCallId: string
	input: { path: string; content: string }
}

export interface ReadToolCallEvent {
	type: 'tool_call'
	toolName: 'read'
	toolCallId: string
	input: { path: string }
}

export interface BashToolCallEvent {
	type: 'tool_call'
	toolName: 'bash'
	toolCallId: string
	input: { command: string; env?: Record<string, string>; timeout?: number; cwd?: string }
}

export interface SearchToolCallEvent {
	type: 'tool_call'
	toolName: 'search'
	toolCallId: string
	input: { pattern: string; paths: string | string[]; i?: boolean; gitignore?: boolean }
}

export interface FindToolCallEvent {
	type: 'tool_call'
	toolName: 'find'
	toolCallId: string
	input: { paths: string[]; hidden?: boolean; gitignore?: boolean }
}

export interface CustomToolCallEvent {
	type: 'tool_call'
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
}

export type ToolCallEvent =
	| BashToolCallEvent
	| ReadToolCallEvent
	| EditToolCallEvent
	| WriteToolCallEvent
	| SearchToolCallEvent
	| FindToolCallEvent
	| CustomToolCallEvent

/** Fired after a tool executes. */
export interface ToolResultEvent {
	type: 'tool_result'
	toolName: string
	toolCallId: string
	input: Record<string, unknown>
	content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
	isError: boolean
}

/**
 * Context passed to extension event handlers.
 * We only need `cwd` from it.
 */
export interface ExtensionContext {
	cwd: string
}

/** Handler function type */
export type ExtensionHandler<E, R = undefined> = (
	event: E,
	ctx: ExtensionContext,
) => Promise<R | void> | R | void

/** Extension factory function type */
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>

/**
 * ExtensionAPI — the `pi` object passed to the factory.
 * We only declare the subset we use (on, logger).
 */
export interface ExtensionAPI {
	on(event: 'session_start', handler: ExtensionHandler<SessionStartEvent>): void
	on(event: 'tool_call', handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult | undefined>): void
	on(event: 'tool_result', handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult | undefined>): void
	logger: { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

/** Return type for tool_call handlers (can block) */
export interface ToolCallEventResult {
	block?: boolean
	reason?: string
}

/** Return type for tool_result handlers (can modify result) */
export interface ToolResultEventResult {
	content?: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
	isError?: boolean
}
