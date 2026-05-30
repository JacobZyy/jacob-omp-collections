# oxlint-gate

Real-time type assertion gate for [oh-my-pi](https://github.com/JacobZyy/oh-my-pi).

Intercepts Edit/Write tool calls and checks the target file with oxlint before allowing the edit to proceed. Blocks if type laziness assertions (e.g., `as any`, `as unknown as X`) are detected.

## Features

- **Real-time blocking**: Checks files before they're saved, not after
- **oxlint integration**: Uses the same rules as your CLI workflow
- **Configurable**: Reads ignore patterns from `~/.config/oxlint/oxlintrc.json`
- **Fail-open**: If oxlint is not installed or crashes, edits are allowed (won't block your workflow)
- **Local logs**: Writes detailed logs to `~/.omp/logs/oxlint-gate.log` for debugging

## Prerequisites

1. **oxlint** installed globally:

   ```bash
   npm install -g oxlint
   ```

2. **oxlint config** at `~/.config/oxlint/oxlintrc.json`:
   ```json
   {
     "rules": {
       "typescript/no-explicit-any": "error",
       "typescript/no-unnecessary-type-assertion": "error"
     },
     "ignorePatterns": ["*.test.ts", "*.config.ts"]
   }
   ```

## Installation

### Via OMP marketplace

```bash
omp plugin install @jacob-omp-collections/oxlint-gate
```

### Manual installation

1. Clone this repository
2. Link the package:
   ```bash
   cd packages/oxlint-gate
   bun link
   ```
3. Add to your OMP config (`~/.omp/agent/config.yml`):
   ```yaml
   extensions:
     - /path/to/jacob-omp-collections/packages/oxlint-gate/src/index.ts
   ```

## How it works

1. When you use Edit/Write tools in OMP, the extension intercepts the tool call
2. It extracts the target file path from the tool input
3. If the file is a TypeScript/Vue file, it runs oxlint with your config
4. If type assertion violations are found, the edit is blocked with a detailed error message
5. The error message includes the violations and suggests how to fix them

## Configuration

The extension reads from `~/.config/oxlint/oxlintrc.json`:

- `rules`: oxlint rules to check
- `ignorePatterns`: glob patterns for files to skip (e.g., `*.test.ts`, `*.config.ts`)

## Logs

Logs are written to `~/.omp/logs/oxlint-gate.log`.

```bash
# View logs in real-time
tail -f ~/.omp/logs/oxlint-gate.log

# Search for blocked edits
grep "BLOCKED" ~/.omp/logs/oxlint-gate.log

# View today's checks
grep "$(date +%Y-%m-%d)" ~/.omp/logs/oxlint-gate.log
```

Log format:

```
[2026-05-30T10:15:30.123Z] [INFO] extension loaded
[2026-05-30T10:15:35.456Z] [INFO] checking: /path/to/file.ts
[2026-05-30T10:15:35.789Z] [WARN] BLOCKED: /path/to/file.ts
Found 2 errors.
...
[2026-05-30T10:16:00.123Z] [INFO] passed: /path/to/other.ts
```

## Error message format

When violations are found, you'll see:

```
❌ [oxlint-gate] 检测到类型偷懒断言 — Found 2 errors.

/path/to/file.ts
  10:5  error  Unexpected any, use a specific type  @typescript-eslint/no-explicit-any
  15:10 error  Unnecessary type assertion            @typescript-eslint/no-unnecessary-type-assertion

按 ts-type-discipline 协议处理：
  1) 优先用泛型 / 条件类型 / 类型守卫消除断言，禁止 as any / as unknown as X
  2) 类型体操无效 → 追溯并修复底层类型声明（接口/DTO/类型定义）
  3) 若是后端接口少返回字段 → 用 AskUserQuestion 与用户确认方案
```

## Differences from Claude Code hook

This is an OMP extension ported from the Claude Code hook in [jacob-skills-collection](https://github.com/JacobZyy/jacob-skills-collection).

| Feature     | Claude Code hook       | OMP extension               |
| ----------- | ---------------------- | --------------------------- |
| Timing      | End of session         | Real-time (before save)     |
| Blocking    | Blocks session         | Blocks tool call            |
| Transcript  | Reads JSONL transcript | Intercepts tool_call events |
| Performance | Batch check at end     | Single file check per edit  |

## License

MIT
