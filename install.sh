#!/usr/bin/env bash
# install.sh — 一键安装 jacob-omp-collections 到本地 OMP 环境
#
# 用法:
#   ./install.sh              # 安装 skills + mcp（需要先 /marketplace install 插件）
#   ./install.sh --all        # 安装全部（包括 marketplace 插件）
#
# 安装内容:
#   - packages/*     → OMP Marketplace 插件（需要 omp 内 /marketplace install）
#   - skills/*       → symlink 到 ~/.omp/agent/skills/
#   - mcp/mcp.json   → merge 到 ~/.omp/agent/mcp.json

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OMP_AGENT_DIR="${OMP_AGENT_DIR:-$HOME/.omp/agent}"
OMP_SKILLS_DIR="$OMP_AGENT_DIR/skills"
MCP_TARGET="$OMP_AGENT_DIR/mcp.json"
MCP_SOURCE="$REPO_DIR/mcp/mcp.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Skills: symlink ──────────────────────────────────────────────────────────

install_skills() {
  info "Installing skills..."
  mkdir -p "$OMP_SKILLS_DIR"

  local count=0
  for skill_dir in "$REPO_DIR"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name="$(basename "$skill_dir")"
    local target="$OMP_SKILLS_DIR/$name"

    if [ -L "$target" ]; then
      rm "$target"
    elif [ -d "$target" ]; then
      warn "  $name: 目录已存在且非 symlink，跳过（如需覆盖请手动 rm -rf $target）"
      continue
    fi

    ln -s "$skill_dir" "$target"
    info "  $name → $target"
    count=$((count + 1))
  done

  if [ "$count" -eq 0 ]; then
    info "  没有 skills 需要安装"
  fi
}

# ── MCP: merge ───────────────────────────────────────────────────────────────

install_mcp() {
  if [ ! -f "$MCP_SOURCE" ]; then
    info "没有 mcp/mcp.json，跳过 MCP 安装"
    return
  fi

  # 检查 mcp.json 是否有实际配置（不只是空的 mcpServers）
  local source_servers
  source_servers="$(python3 -c "
import json, sys
d = json.load(open('$MCP_SOURCE'))
servers = d.get('mcpServers', {})
print(len(servers))
" 2>/dev/null || echo "0")"

  if [ "$source_servers" = "0" ]; then
    info "mcp/mcp.json 中没有 MCP server 配置，跳过"
    return
  fi

  info "Installing MCP servers..."

  if [ -f "$MCP_TARGET" ]; then
    # merge: 以 mcp_source 为准覆盖同名 key
    python3 -c "
import json, sys

with open('$MCP_TARGET') as f:
    existing = json.load(f)
with open('$MCP_SOURCE') as f:
    incoming = json.load(f)

existing.setdefault('mcpServers', {})
incoming_servers = incoming.get('mcpServers', {})

added = []
for name, config in incoming_servers.items():
    if name not in existing['mcpServers']:
        added.append(name)
    existing['mcpServers'][name] = config

with open('$MCP_TARGET', 'w') as f:
    json.dump(existing, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f'merged {len(incoming_servers)} servers, {len(added)} new')
" 2>/dev/null
    info "  merged into $MCP_TARGET"
  else
    cp "$MCP_SOURCE" "$MCP_TARGET"
    info "  created $MCP_TARGET"
  fi
}

# ── Marketplace plugins ──────────────────────────────────────────────────────

install_marketplace() {
  info "Marketplace 插件需要手动安装（在 omp 会话内执行）:"
  echo ""
  echo "  /marketplace add JacobZyy/jacob-omp-collections"

  # 读取 marketplace.json 中的插件名
  if command -v python3 &>/dev/null; then
    local plugins
    plugins="$(python3 -c "
import json
with open('$REPO_DIR/.claude-plugin/marketplace.json') as f:
    d = json.load(f)
for p in d.get('plugins', []):
    print(f\"  /marketplace install {p['name']}@{d['name']}\")
" 2>/dev/null)"
    if [ -n "$plugins" ]; then
      echo "$plugins"
    fi
  fi
  echo ""
}

# ── Uninstall ────────────────────────────────────────────────────────────────

uninstall() {
  info "Uninstalling..."

  # Remove skill symlinks
  for skill_dir in "$REPO_DIR"/skills/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name="$(basename "$skill_dir")"
    local target="$OMP_SKILLS_DIR/$name"
    if [ -L "$target" ]; then
      rm "$target"
      info "  removed skill: $name"
    fi
  done

  # Remove MCP servers that came from this repo
  if [ -f "$MCP_SOURCE" ] && [ -f "$MCP_TARGET" ]; then
    python3 -c "
import json
with open('$MCP_SOURCE') as f:
    incoming = json.load(f).get('mcpServers', {})
with open('$MCP_TARGET') as f:
    existing = json.load(f)
removed = []
for name in incoming:
    if name in existing.get('mcpServers', {}):
        del existing['mcpServers'][name]
        removed.append(name)
with open('$MCP_TARGET', 'w') as f:
    json.dump(existing, f, indent=2, ensure_ascii=False)
    f.write('\n')
if removed:
    print(f'removed {len(removed)} MCP servers: {', '.join(removed)}')
else:
    print('no MCP servers to remove')
" 2>/dev/null
  fi

  info "Done. Marketplace plugins 需要手动 uninstall: /marketplace uninstall <name>@jacob-omp-collections"
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --all)
    install_marketplace
    install_skills
    install_mcp
    info "Done!"
    ;;
  --uninstall)
    uninstall
    ;;
  --help|-h)
    echo "用法: $0 [--all|--uninstall|--help]"
    echo ""
    echo "  (无参数)     安装 skills + MCP（marketplace 插件需手动安装）"
    echo "  --all        显示 marketplace 安装命令 + 安装 skills + MCP"
    echo "  --uninstall  移除所有已安装的 skills 和 MCP"
    echo "  --help       显示帮助"
    ;;
  *)
    install_skills
    install_mcp
    info "Done! Marketplace 插件请手动安装（$0 --all 查看命令）"
    ;;
esac
