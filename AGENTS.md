# AGENTS.md

## 项目结构

统一管理 OMP 的插件、Skills、MCP 配置。所有内容集中在这个仓库，通过 `install.sh` 一键安装到本地。

```
jacob-omp-collections/
  .claude-plugin/
    marketplace.json          ← Marketplace 索引，声明 extensions/hooks/tools/commands 类型的插件
  packages/                   ← Marketplace 插件（通过 /marketplace install 安装）
    aicodegather/
      package.json            ← 必须包含 omp.extensions 字段
      src/index.ts            ← Extension 入口
  skills/                     ← Skills（symlink 到 ~/.omp/agent/skills/）
    example/
      SKILL.md
  mcp/                        ← MCP servers（merge 到 ~/.omp/agent/mcp.json）
    mcp.json
  install.sh                  ← 一键安装脚本
```

## 安装

```bash
./install.sh              # 安装 skills + MCP
./install.sh --all        # 安装全部（含 marketplace 插件提示）
./install.sh --uninstall  # 卸载
```

Marketplace 插件需要在 omp 会话内手动安装：

```
/marketplace add JacobZyy/jacob-omp-collections
/marketplace install aicodegather@jacob-omp-collections
```

## 添加内容

### 添加 Marketplace 插件（extensions/tools/hooks/commands）

1. 在 `packages/` 下新建目录
2. 编写 `src/index.ts` 入口
3. `package.json` 声明 `omp.extensions`：

```json
{
  "name": "@jacob-omp-collections/<plugin-name>",
  "omp": { "extensions": ["./src/index.ts"] }
}
```

4. 在 `.claude-plugin/marketplace.json` 的 `plugins` 追加：

```json
{
  "name": "<plugin-name>",
  "description": "描述",
  "source": "./packages/<plugin-name>"
}
```

5. 提交推送 → 用户 `/marketplace update jacob-omp-collections`

### 添加 Skill

1. 在 `skills/` 下新建目录，放入 `SKILL.md`
2. 运行 `./install.sh`，脚本自动 symlink 到 `~/.omp/agent/skills/<name>`

OMP 加载路径：`~/.omp/agent/skills/*/SKILL.md`

### 添加 MCP Server

1. 编辑 `mcp/mcp.json`，在 `mcpServers` 中添加 server 配置：

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"]
    }
  }
}
```

2. 运行 `./install.sh`，脚本 merge 到 `~/.omp/agent/mcp.json`

OMP 加载路径：`~/.omp/agent/mcp.json`

## OMP Extension API

```ts
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent'

export default function myPlugin(pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => { /* ... */ })
  pi.on('tool_call', async (event) => { /* ... */ })
  pi.on('tool_result', async (event) => { /* ... */ })
}
```

可用事件：`session_start`、`tool_call`、`tool_result`、`turn_start`、`turn_end`、`context` 等。

## 命名规范

- 目录名：小写字母、数字、连字符
- marketplace.json 中的 `name` 与目录名一致

## 约束

- Skills 和 MCP 不能通过 marketplace 插件分发，只能通过 symlink/merge 安装
- 不要在 `packages/` 下放非插件内容
- 不要修改 `.claude-plugin/marketplace.json` 的顶层结构（name、owner）

## 开发校验

每次开发完成后，MUST 按顺序执行以下步骤，确保代码质量：

1. **lint:fix**：`bun run lint:fix`。仍有报错则手动修复后重新执行，直到零报错。
2. **单测**：`bunx vitest run`（根目录执行，自动扫描 `packages/*/src/**/*.test.ts`）。失败则修复后重新执行，直到全部通过。