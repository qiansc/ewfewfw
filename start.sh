#!/bin/bash
# C4A v0.2 启动脚本入口

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================
# 加载已安装工具的路径
# ============================================================

# bun
if [ -d "$HOME/.bun/bin" ]; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# cargo (Rust)
if [ -d "$HOME/.cargo/bin" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# ============================================================
# 安装项目依赖
# ============================================================

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo ""
    echo -e "${BLUE}首次运行，正在安装依赖...${NC}"
    cd "$SCRIPT_DIR" && bun install
    echo ""
fi

# ============================================================
# 启动 CLI
# ============================================================

exec bun "$SCRIPT_DIR/packages/cli-dev/src/index.tsx" "$@"
