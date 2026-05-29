# aicodegather OMP Extension — 排查记录

> 最后更新：2026-05-29，当前源码版本 1.4.3（commit `b44cff5`，已回退 1.5.0）

## 问题现状

`tool_call` 和 `tool_result` 事件未在 hook.log 中出现。

## 已确认的结论

### 1. 插件代码本身没有问题 ✅（已验证）

在 `omp-integration.test.ts` 中完整模拟了 OMP 运行时的调用链：

- `ConcreteExtensionAPI.on()` → handler 存入 `extension.handlers` Map
- `ExtensionRunner.emitToolCall()` → 遍历 extensions 取 handlers 调用
- `ExtensionRunner.emitToolResult()` → 同上
- `hasHandlers("tool_call")` → 检查 Map

**全部 13 个测试通过**，包括：
- `export default` 是 function ✅
- 注册了 `session_start` / `tool_call` / `tool_result` 三个 handler ✅
- `tool_call` handler 在 edit/write 工具调用时正确触发 ✅
- `hasHandlers("tool_call")` 返回 true ✅
- `console.error` 输出了 `[aicodegather] tool_call fired: toolName=edit` ✅

**结论：问题不在插件代码，而在 OMP 侧的加载/运行环境。**

### 2. 当前环境状态：symlink broken，插件根本无法加载

```
~/.omp/plugins/ 状态三处不一致：

installed_plugins.json → 1.5.0
package.json deps      → 1.4.3
symlink target         → 1.4.3 (目录不存在，只有 1.5.0 缓存)
```

`resolveManifestEntryFile()` 使用 `fs.statSync()` 跟随 symlink → 目标不存在 → 返回 null → **插件不会被发现**。

### 3. OMP 运行时版本确认

- 运行中的 OMP：v15.5.10（通过 `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/`）
- 源码 workspace：同版本 v15.5.10，`sdk.ts` 行数一致（2212 行）
- **源码和运行版本一致，不存在版本差异问题**

### 4. OMP Extension 事件触发链路（源码追踪）

```
工具执行：
  sdk.ts:1526  →  toolRegistry.set(tool.name, new ExtensionToolWrapper(tool, extensionRunner))
  wrapper.ts:106  →  ExtensionToolWrapper.execute(toolCallId, params, ...)
  wrapper.ts:146  →  if (this.runner.hasHandlers("tool_call"))
  wrapper.ts:148  →  await this.runner.emitToolCall({ type, toolName, toolCallId, input })
  runner.ts:614   →  emitToolCall() 遍历 this.extensions → ext.handlers.get("tool_call")
  loader.ts:138   →  ConcreteExtensionAPI.on(event, handler) 存入 extension.handlers Map

session_start 触发（交互模式）：
  extension-ui-controller.ts:234  →  extensionRunner.initialize(...)
  extension-ui-controller.ts:242  →  await extensionRunner.emit({ type: "session_start" })

tool_call 触发：
  每次 AgentTool.execute() 被调用时 → ExtensionToolWrapper.execute() → emitToolCall()
  使用同一个 extensionRunner 实例
```

同一个 `extensionRunner` 实例贯穿全程（sdk.ts 创建 → 传给 AgentSession → 传给 ExtensionToolWrapper）。

### 5. `loadLegacyPiModule` 行为

OMP 不会直接 import 插件源文件。而是：
1. 读源文件文本
2. 重写 imports（`@oh-my-pi/*` → 本地路径、相对路径 → 镜像路径、bare imports → 解析路径）
3. 写入 `/tmp/omp-legacy-pi-file/` 临时文件
4. `import(mirroredPath + ?mtime=...)` 加载镜像文件

这个重写过程**不影响 export default 的值**，仅改 import 路径。`import type` 在运行时完全擦除，不受影响。

## 历史版本对比

### v1.3.0（能工作）
```ts
// export default function，内联 pi 类型
export default function aicodegather(pi: {
  on: ((event: 'session_start', handler: ...) => void) &
      ((event: 'tool_call', handler: ...) => void) &
      ((event: 'tool_result', handler: ...) => void)
}): void {
  // diag() 直接写 /tmp/aicodegather/logs/hook.log
  // filePath 用 event.input?.file_path ?? event.input?.path
}
```

### v1.4.3（当前源码，symlink broken 无法实际验证）
```ts
// const + type import
import type { ExtensionAPI, ExtensionFactory } from './omp-types'
const aicodegather: ExtensionFactory = (pi: ExtensionAPI): void => {
  // log.info() 写 /tmp/aicodegather/logs/hook.log
  // filePath 用 extractFilePath(event.input)
}
export default aicodegather
```

### v1.5.0（回退 export default function，symlink broken 无法验证）
```ts
export default function aicodegather(pi: {
  on: ...
}): void {
  // 同 v1.3.0 的 export 形式，但用新的 extractFilePath 逻辑
}
```

## 日志时间线分析

```
08:04 ~ 08:44  v1.3.0 活跃
  [DIAG] [module-top] aicodegather module evaluated    ← diag() 输出
  [DIAG] [tool_call] toolName=edit                     ← tool_call 正常触发
  [DIAG] [tool_call-path] filePath=undefined           ← edit 的 filePath 提取失败
  [DIAG] [tool_call-path] filePath=/Users/.../foo.ts   ← write 的 filePath 正常

08:50 ~         v1.4.3/1.5.0 活跃
  [INFO] [index] aicodegather extension loaded         ← factory 执行了
  [INFO] [index] session start: cwd=...                ← session_start 触发了
  ❌ 没有 tool_call / tool_result 日志                  ← 问题！
```

## 根本原因分析（待验证）

### 假设 A：symlink 在 08:50 时已经是 broken 的

如果 symlink broken，OMP 通过 `getAllPluginExtensionPaths()` 根本发现不了插件。但日志显示 `session_start` 触发了。

**可能解释**：OMP 有 fallback 的 extension 发现路径（`~/.omp/agent/extensions/` 或 settings `extensions` 数组），或者之前 symlink 有效但之后变了。

### 假设 B：`loadLegacyPiModule` 重写导致的问题

v1.3.0 有顶层副作用代码 `diag('module-top', ...)`，日志中可见 `[DIAG] [module-top]`。v1.4.3+ 没有顶层副作用。如果 `loadLegacyPiModule` 的重写过程**因为某种 import 解析失败**导致 factory 没有被正确调用，但模块加载成功（返回了一个不完整的对象），那么：
- `getExtensionFactory()` 会返回 null → 扩展不会被加载 → `session_start` 也不会触发

这与日志矛盾（session_start 触发了），所以此假设不成立。

### 假设 C：`ConcreteExtensionAPI.on()` 的泛型签名问题

v1.4.3 使用 `import type { ExtensionAPI } from './omp-types'`。运行时 `ConcreteExtensionAPI.on()` 的签名是：
```ts
on<F extends HandlerFn>(event: string, handler: F): void
```

v1.3.0 的 `pi.on` 类型签名是内联的交叉类型。但 TypeScript 类型在运行时擦除，不影响行为。**已排除。**

### 假设 D：最有可能是 OMP 运行时环境的特定问题

由于：
1. 插件代码在模拟测试中完全正常
2. `session_start` 能触发说明 factory 确实执行了，handlers 确实注册了
3. `tool_call` 不触发说明 `ExtensionToolWrapper.execute()` 的 `hasHandlers("tool_call")` 返回了 false

**最可能的原因是：OMP 运行时中使用的 `extensionRunner` 实例和注册 handlers 时的不是同一个。**

具体来说：`sdk.ts:1470` 创建 `ExtensionRunner`，其 `extensions` 数组包含加载的插件。但 `ConcreteExtensionAPI.on()` 注册 handlers 到 `this.extension.handlers`，这个 `extension` 对象也在 `extensions` 数组中。只要 `extensionRunner` 是同一个实例，handlers 就能被找到。

**除非存在某种模块重复加载**（Bun import 两次返回不同的模块实例），导致 factory 中的 `pi.on()` 注册到了 extension A，但 runner 遍历的是 extension B。

## 下一步行动

### 立即要做的

1. **修复 symlink 和 package.json**：
   ```bash
   # 修复 symlink 指向实际存在的 1.5.0 缓存
   ln -sf ~/.omp/plugins/cache/plugins/jacob-omp-collections___aicodegather___1.5.0 \
          ~/.omp/plugins/node_modules/@jacob-omp-collections/aicodegather

   # 更新 package.json 使版本一致
   cat > ~/.omp/plugins/package.json << 'EOF'
   {"name":"omp-plugins","private":true,"dependencies":{"dir-entry-plugin":"1.0.0","@jacob-omp-collections/aicodegather":"1.5.0"}}
   EOF
   ```

2. **重启 OMP 并测试**：看 hook.log 中是否有 tool_call 日志

### 如果修复 symlink 后 tool_call 仍不触发

3. **在 OMP 源码中加临时诊断日志**：
   - `packages/coding-agent/src/extensibility/extensions/wrapper.ts:146` — 打印 `hasHandlers` 结果和 `this.runner.extensions` 长度
   - `packages/coding-agent/src/extensibility/extensions/runner.ts:392` — 在 `hasHandlers()` 中打印 `this.extensions` 的 handlers keys

4. **验证 loadLegacyPiModule 的镜像文件**：
   ```bash
   # 在 OMP 运行时检查临时目录
   ls /tmp/omp-legacy-pi-file/
   # 查看镜像后的文件内容
   cat /tmp/omp-legacy-pi-file/module-*.ts
   ```

5. **或者：绕过 marketplace，用 `--extension` 参数直接加载源文件**：
   ```bash
   omp --extension ~/Documents/workspace/jacob-open-source/jacob-omp-collections/packages/aicodegather/src/index.ts
   ```
   这跳过了 `loadLegacyPiModule` 的重写过程，直接 import 源文件。如果 tool_call 触发了，问题就在 `loadLegacyPiModule` 的重写逻辑。

### 如果需要在 OMP 源码中加诊断

在 `packages/coding-agent/src/extensibility/extensions/wrapper.ts` 的 `execute` 方法中（约 line 146）：

```ts
// 临时诊断
console.error(`[DIAG-WRAPPER] tool=${this.tool.name}, hasHandlers=${this.runner.hasHandlers("tool_call")}`);
```

在 `packages/coding-agent/src/extensibility/extensions/runner.ts` 的 `hasHandlers` 方法中（约 line 392）：

```ts
hasHandlers(eventType: string): boolean {
    console.error(`[DIAG-RUNNER] hasHandlers(${eventType}), extensions=${this.extensions.length}`);
    for (const ext of this.extensions) {
        const handlers = ext.handlers.get(eventType);
        console.error(`[DIAG-RUNNER]   ext=${ext.path}, handlerKeys=[${[...ext.handlers.keys()].join(',')}]`);
        if (handlers && handlers.length > 0) {
            return true;
        }
    }
    return false;
}
```

## OMP Extension 加载机制（源码速查）

```
discoverAndLoadExtensions(configuredPaths, cwd)
  → getAllPluginExtensionPaths(cwd)          // 读 package.json deps → resolveManifestEntryFile → fs.statSync
  → loadExtensions(paths, cwd)
    → for each path: loadExtension(path, cwd, eventBus, runtime)
      → loadLegacyPiModule(resolvedPath)     // 重写 imports，写入 /tmp 镜像文件，import 镜像
      → getExtensionFactory(module)           // module.default ?? module，检查是 function
      → createExtension(path, resolvedPath)   // { handlers: new Map(), ... }
      → new ConcreteExtensionAPI(piCodingAgent, extension, runtime, cwd, eventBus)
      → factory(api)                          // 执行工厂函数，pi.on() 注册 handlers
    → new ExtensionRunner(extensions, runtime, cwd, sessionManager, modelRegistry)

sdk.ts:1525-1526  // 包裹所有工具
  for (const tool of toolRegistry.values()) {
    toolRegistry.set(tool.name, new ExtensionToolWrapper(tool, extensionRunner))
  }

ExtensionToolWrapper.execute(toolCallId, params, ...)
  → this.runner.hasHandlers("tool_call")     // runner.ts:392 遍历 extensions 检查 handlers Map
  → this.runner.emitToolCall({...})           // runner.ts:614 遍历 extensions 调用 handlers
```

## 单测文件

- `src/index.test.ts` — `extractFilePath` 的 12 个单元测试
- `src/omp-integration.test.ts` — **模拟 OMP 完整调用链的 13 个集成测试**（全部通过）
- `src/diff.test.ts`、`src/file-filter.test.ts`、`src/git-ops.test.ts` — 其他单元测试

全部 45 + 13 = 58 个测试通过。
