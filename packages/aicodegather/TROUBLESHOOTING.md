# aicodegather OMP Extension — 未解决问题文档

> 最后更新：2026-05-29，当前版本 1.5.0，commit `6d0b621`

## 问题现状

Extension 的 `session_start` 事件正常触发并上报成功，但 `tool_call` 和 `tool_result` 事件完全不触发。即使加了 `console.error()` 也无任何输出，说明 handler 从未被执行。

## 已确认的事实

### 能工作的版本

`2c925138` (v1.3.0) — tool_call 能触发，日志中有 `[DIAG] [tool_call] toolName=edit` 输出。但 filePath 提取失败（`filePath=undefined`），因为当时用的是 `event.input?.file_path` 而非 `event.input?.path`。

### 不能工作的版本

`4f47151` (v1.4.0) 及之后所有版本（1.4.0 ~ 1.5.0），tool_call / tool_result 完全不触发。

### 1.3.0 → 1.4.0 的变更

1. **引入 `omp-types.ts` 类型桥接文件**（纯 interface/type，运行时擦除）
2. **Factory 签名**：从 `export default function aicodegather(pi: { on: ... })` 改为 `const aicodegather: ExtensionFactory = (pi: ExtensionAPI) => { ... }; export default aicodegather`
3. **filePath 提取**：从 `event.input?.file_path ?? event.input?.path` 改为 `extractFilePath(event.input)` 函数
4. **移除 `diag()` 诊断函数**
5. **修复 `getGitNamespace()` regex bug**

### 1.5.0 的回退尝试

已回退到 1.3.0 的 `export default function` + 内联 `pi` 类型签名，保留新的 `extractFilePath` 逻辑和完整日志。**问题仍然存在**。

### Plugin 加载确认

- `~/.omp/plugins/installed_plugins.json` 正确记录插件（v1.4.3/1.5.0）
- `~/.omp/plugins/cache/plugins/jacob-omp-collections___aicodegather___1.5.0/` 目录存在且 `src/index.ts` 可读
- `session_start` handler 正常触发（日志中有 `aicodegather extension loaded` + `session start: cwd=...`）
- 但同一 factory 函数中注册的 `tool_call` / `tool_result` handler 从未被调用

### Symlink 问题（已修复但仍反复出现）

OMP `marketplace update` 流程：
1. `cachePlugin()` 创建新版本缓存目录（如 `___aicodegather___1.5.0`）
2. 删除旧版本缓存目录
3. 更新 `installed_plugins.json`

但 **不会更新 `node_modules/@jacob-omp-collections/aicodegather` symlink**。每次 update 后 symlink dangling，需要手动修复：

```bash
ln -sf ~/.omp/plugins/cache/plugins/jacob-omp-collections___aicodegather___1.5.0 \
       ~/.omp/plugins/node_modules/@jacob-omp-collections/aicodegather
```

不过 symlink 断裂时 session_start 也不会触发，所以当前问题与 symlink 无关。

## OMP Extension 加载机制（源码分析）

### 插件发现

1. `discoverAndLoadExtensions()` (`loader.ts:484`) 调用 `getAllPluginExtensionPaths(cwd)`
2. `getAllPluginExtensionPaths()` → `getEnabledPlugins(cwd)` → 读取 `~/.omp/plugins/package.json` 的 `dependencies`
3. 对每个 plugin 读取 `node_modules/<name>/package.json` 的 `omp.extensions` 字段
4. `resolveManifestEntryFile()` 用 `fs.statSync()` 解析路径（dangling symlink 返回 null）

### Extension 加载

1. `loadExtension()` (`loader.ts:277`) 用 `loadLegacyPiModule()` import TS 文件
2. `getExtensionFactory()` 检查 module.default 是否为 function
3. 创建 `ConcreteExtensionAPI`，调用 `factory(api)`
4. Factory 中的 `pi.on('tool_call', handler)` 注册到 `extension.handlers` Map

### 事件触发

1. 每个工具被 `ExtensionToolWrapper` 包裹（`sdk.ts:1526`）
2. 工具执行前 `wrapper.execute()` 调用 `runner.emitToolCall()`
3. `emitToolCall()` 遍历所有 extension 的 `handlers.get("tool_call")` 并调用

### 关键代码路径

```
sdk.ts:1526  →  new ExtensionToolWrapper(tool, runner)  // 包裹每个工具
wrapper.ts:146  →  if (this.runner.hasHandlers("tool_call"))  // 检查是否有 handler
wrapper.ts:148  →  await this.runner.emitToolCall({...})  // 触发事件
runner.ts:618  →  for (ext of this.extensions) { ext.handlers.get("tool_call") }  // 查找 handler
```

## 已排除的原因

| 假设 | 排除依据 |
|------|---------|
| omp-types.ts import 导致运行时错误 | 纯 type 文件，运行时擦除；1.5.0 已去掉该 import |
| `const` vs `function` export 方式 | Bun import 两种方式的 `.default` 都是 function |
| Extension 加载失败（异常被吞） | session_start 正常触发，说明 factory 已执行 |
| Handler 未注册 | pi.on() 在 session_start 同一 factory 中调用，session_start 成功说明注册代码已执行 |
| Symlink 断裂 | 修复后 session_start 能触发，但 tool_call 仍不触发 |
| 插件版本不匹配 | 已多次确认 symlink 和 package.json 指向正确版本 |
| `console.error` 被吞 | 不太可能，stderr 不经过 OMP 日志系统 |

## 未验证的假设

1. **`runner.hasHandlers("tool_call")` 返回 false** — 可能 extensions 数组为空或 handlers Map 未正确填充。需要 OMP 侧加日志确认。
2. **ExtensionToolWrapper 未包裹 edit/write 工具** — 可能 `toolRegistry.set(tool.name, new ExtensionToolWrapper(tool, runner))` 未执行到 edit/write。
3. **多 ExtensionRunner 实例** — session_start 走一个 runner，tool_call 走另一个。需要确认 sdk.ts 中 runner 是否为单例。
4. **OMP 版本问题** — 当前 oh-my-pi 的代码可能和运行的 OMP 二进制版本不一致（当前 workspace 是 oh-my-pi 源码，但运行的 OMP 可能是已安装的 release 版本）。
5. **loadLegacyPiModule 行为差异** — 这个函数对 `export default function` 和 `export default constVariable` 可能有不同处理。

## 建议的下一步排查

1. **确认运行中的 OMP 版本**：检查 `omp --version` 或 OMP 启动日志，确认用的是源码编译版还是 release 版
2. **在 OMP 侧加日志**：在 `wrapper.ts:146` 行加 `console.error`，确认 `hasHandlers("tool_call")` 的结果
3. **在 OMP 侧加日志**：在 `runner.ts:392` `hasHandlers()` 方法中打印 `this.extensions` 内容
4. **在 OMP 侧加日志**：在 `sdk.ts:1526` 包裹工具时打印工具名和 runner 的 extensions 数量
5. **检查 edit 工具是否被特殊处理**：`sdk.ts:1528` 有 `if (model?.provider === "cursor") toolRegistry.delete("edit")`，确认 provider 不是 cursor

## Python Hooks（旧方案，仍在运行）

当前 `~/.claude/settings.json` 仍配置了三个 Python hooks：

- `PreToolUse` (Edit|Write) → `pre_edit.py`
- `PostToolUse` (Edit|Write) → `post_edit.py`
- `SessionStart` → `session_start.py`

这些 hooks 工作正常，日志输出到 `/tmp/aicodegather/logs/hook.log`。

Python hooks 和 OMP extension 共存时，两者都会触发 session_start。但 Python hooks 的 tool_call 事件走 Claude hooks 机制，OMP extension 的走 OMP extension 机制，互不影响。

## 日志对比表：Python Hooks vs TS Extension

| 阶段 | Python hook 日志点 | TS extension (1.5.0) 日志点 | 状态 |
|------|-------------------|---------------------------|------|
| **session_start** | | | |
| 开始 | `==================================================` + `session_start 开始执行` | ✅ 同上 | ✅ |
| cwd | `session start: cwd=...` | ✅ 同上 | ✅ |
| 用户信息 | `[DEBUG] 获取用户信息: user_name=..., env=..., ip=..., version=...` | ⚠️ 有但缺 ip（OMP 环境无 netifaces） | ⚠️ |
| 发送埋点 | `========== 发送埋点 ==========` | ✅ 同上 | ✅ |
| URL/payload | `[DEBUG] URL: ... / payload: ...` | ✅ 同上 | ✅ |
| 响应状态码 | `[DEBUG] 响应状态码: ...` | ✅ 同上 | ✅ |
| 响应 body | `[DEBUG] 响应body: ...` | ✅ 已补充 | ✅ |
| 成功 | `埋点发送成功` | ✅ 同上 | ✅ |
| 失败 | `埋点发送失败: status_code=...` | ✅ 同上 | ✅ |
| 完成 | `session_start 执行完成` | ✅ 同上 | ✅ |
| **pre_edit (tool_call)** | | | |
| 开始 | `==================================================` + `pre_edit 开始执行` | ✅ 同上 | ⚠️ 不触发 |
| 解析失败 | `[ERROR] 未找到file_path` | ✅ 含 input keys | ⚠️ 不触发 |
| 文件路径 | `[INFO] 处理文件: ...` | ✅ 同上 | ⚠️ 不触发 |
| Git remote | `[DEBUG] Git远程URL: ...` | ✅ 同上 | ⚠️ 不触发 |
| 跳过非gitlab | `[INFO] 跳过: 非gitlab仓库, remote_url=...` | ✅ 同上 | ⚠️ 不触发 |
| 跳过过滤文件 | `[INFO] 跳过: 文件不在过滤范围内, file_path=...` | ✅ 同上 | ⚠️ 不触发 |
| 文件内容 | `[DEBUG] 读取文件内容: length=..., file_path=...` | ✅ 同上 | ⚠️ 不触发 |
| Git信息 | `[DEBUG] Git信息: {...}` | ✅ 同上 | ⚠️ 不触发 |
| 相对路径 | `[DEBUG] 相对路径: ...` | ✅ 同上 | ⚠️ 不触发 |
| 保存缓存 | `[INFO] 保存临时文件: ...`（TS: `pre-edit cached: ...`） | ✅ 等价 | ⚠️ 不触发 |
| 完成 | `pre_edit 执行完成` | ✅ 同上 | ⚠️ 不触发 |
| **post_edit (tool_result)** | | | |
| 开始 | `==================================================` + `post_edit 开始执行` | ✅ 同上 | ⚠️ 不触发 |
| 解析失败 | `[ERROR] 未找到file_path` | ✅ 同上 | ⚠️ 不触发 |
| 文件路径 | `[INFO] 处理文件: ...` | ✅ 同上 | ⚠️ 不触发 |
| 跳过过滤 | `[INFO] 跳过: 文件不在过滤范围内` | ✅ 同上 | ⚠️ 不触发 |
| pre数据缺失 | `[ERROR] 未找到pre_edit数据: ...` | ✅ 同上 | ⚠️ 不触发 |
| 读pre数据 | `[DEBUG] 读取pre数据: ...` | ✅ 同上 | ⚠️ 不触发 |
| after内容 | `[DEBUG] 读取after内容: length=...` | ✅ 同上 | ⚠️ 不触发 |
| diff计算 | `[DEBUG] 计算diff: diff_length=...` | ✅ 同上 | ⚠️ 不触发 |
| diff为空 | `[INFO] diff为空，跳过` | ✅ 同上 | ⚠️ 不触发 |
| 组装数据 | `[DEBUG] 组装数据: {...}` | ✅ 已补充 | ⚠️ 不触发 |
| 开始上报 | `[INFO] 开始立即上报: batch_id=...` | ✅ `开始立即上报: filePath=...` | ⚠️ 不触发 |
| URL/payload | `[DEBUG] URL/payload: ...` | ✅ 同上 | ⚠️ 不触发 |
| 上报成功 | `[INFO] 立即上报成功: batch_id=...` | ✅ `立即上报成功: ...` | ⚠️ 不触发 |
| 上报失败 | `[WARNING] 立即上报失败，启动补偿进程` | ⚠️ `加入重试队列`（内存重试，无独立进程） | ⚠️ 不触发 |
| isError跳过 | — | ✅ `isError=true, 跳过` | ⚠️ 不触发 |
| 完成 | `post_edit 执行完成` | ✅ 同上 | ⚠️ 不触发 |

## marketplace update 后手动修复步骤

每次 `/marketplace update jacob-omp-collections` 后需要执行：

```bash
# 1. 查看最新缓存版本
ls ~/.omp/plugins/cache/plugins/

# 2. 更新 symlink（替换版本号）
ln -sf ~/.omp/plugins/cache/plugins/jacob-omp-collections___aicodegather___<VERSION> \
       ~/.omp/plugins/node_modules/@jacob-omp-collections/aicodegather

# 3. 更新 package.json（替换版本号）
cat > ~/.omp/plugins/package.json << EOF
{"name":"omp-plugins","private":true,"dependencies":{"dir-entry-plugin":"1.0.0","@jacob-omp-collections/aicodegather":"<VERSION>"}}
EOF

# 4. 重启 OMP session
```
