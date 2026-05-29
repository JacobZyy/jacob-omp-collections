---
name: update-jacob-omp
description: Use when the user wants to release a new version of a plugin in jacob-omp-collections. Covers version bumping, commit, and push. Trigger when user says "发布", "升级版本", "release", "bump version" for any plugin.
---

# jacob-omp-collections 发布流程

## 版本号在哪

每个插件的版本号在 `packages/<plugin-name>/package.json` 的 `version` 字段。

OMP 通过以下优先级取版本号：
1. marketplace.json 中 plugin entry 的 `version`（我们不用）
2. **`package.json` 的 `version`**（我们用这个）
3. Git SHA

## 发布步骤

当用户要求发布某个插件的新版本时：

1. 根据改动内容决定版本号（semver 格式，如 `1.0.0` → `1.1.0`）
2. 修改 `packages/<plugin-name>/package.json` 的 `version` 字段
3. 提交：`git commit -m "release: <plugin-name>@<version>"`
4. 推送：`git push`

## 当前插件清单

| 插件 | 路径 | 当前版本 |
|---|---|---|
| aicodegather | packages/aicodegather/ | 见 package.json |

## 注意事项

- 只改 `version` 字段，不要改其他内容
- commit message 格式固定：`release: <plugin-name>@<version>`
- 不要修改 `.claude-plugin/marketplace.json`
