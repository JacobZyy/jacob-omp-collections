# AGENTS.md

## 项目结构

这是一个 OMP (Oh My Pi) 插件集合，通过 Marketplace 机制分发。

```
jacob-omp-collections/
  .claude-plugin/
    marketplace.json          ← Marketplace 索引，声明所有可安装插件
  packages/
    aicodegather/             ← 单个插件，每个插件一个目录
      package.json            ← 必须包含 omp.extensions 字段
      src/
        index.ts              ← Extension 入口
  package.json                ← monorepo 根（workspaces）
```

## 添加新插件流程

1. 在 `packages/` 下新建目录，目录名即为插件名（小写字母、数字、连字符）
2. 编写插件代码，入口文件放在 `src/index.ts`
3. `package.json` 中必须声明 `omp.extensions` 指向入口文件：

```json
{
  "name": "@jacob-omp-collections/<plugin-name>",
  "omp": {
    "extensions": ["./src/index.ts"]
  }
}
```

4. 在 `.claude-plugin/marketplace.json` 的 `plugins` 数组中追加一条：

```json
{
  "name": "<plugin-name>",
  "description": "插件描述",
  "source": "./packages/<plugin-name>"
}
```

5. 提交推送后，用户侧执行 `/marketplace update jacob-omp-collections` 即可拉到最新

## 命名规范

- 插件目录名：小写字母、数字、连字符（`aicodegather`、`my-plugin`）
- marketplace.json 中的 `name` 必须与目录名一致

## OMP Extension API

入口文件导出一个 default function，接收 `ExtensionAPI` 实例：

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function myPlugin(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    // ...
  });

  pi.on("tool_call", async (event) => {
    // ...
  });

  pi.on("tool_result", async (event) => {
    // ...
  });
}
```

可用事件：`session_start`、`tool_call`、`tool_result`、`turn_start`、`turn_end`、`context` 等。

## 不要做的事

- 不要修改 `.claude-plugin/marketplace.json` 的顶层结构（name、owner）
- 不要在插件 `package.json` 中遗漏 `omp.extensions` 字段，否则 OMP 无法发现入口
- 不要在 `packages/` 下放非插件内容
