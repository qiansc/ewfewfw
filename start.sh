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

# uv (Python)
if [ -d "$HOME/.local/bin" ]; then
    export PATH="$HOME/.local/bin:$PATH"
fi

# cargo (Rust，uv 可能需要)
if [ -d "$HOME/.cargo/bin" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# ============================================================
# 检查所有依赖
# ============================================================

MISSING_DEPS=()
MISSING_CMDS=()

echo ""
echo "检查依赖..."

# 1. 检查 bun
if command -v bun &> /dev/null; then
    echo -e "${GREEN}✅ bun${NC}"
else
    echo -e "${RED}❌ bun${NC} - JavaScript 运行时"
    MISSING_DEPS+=("bun")
    MISSING_CMDS+=("curl -fsSL https://bun.sh/install | bash")
fi

# 2. 检查 uv
if command -v uv &> /dev/null; then
    echo -e "${GREEN}✅ uv${NC}"
else
    echo -e "${RED}❌ uv${NC} - Python 包管理器"
    MISSING_DEPS+=("uv")
    MISSING_CMDS+=("curl -LsSf https://astral.sh/uv/install.sh | sh")
fi

# 3. 检查 Docker
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✅ docker${NC}"
else
    echo -e "${RED}❌ docker${NC} - 存储服务运行时"
    MISSING_DEPS+=("docker")
    # macOS 使用 Homebrew，Linux 使用官方脚本
    if [[ "$OSTYPE" == "darwin"* ]]; then
        MISSING_CMDS+=("brew install --cask docker && open /Applications/Docker.app")
    else
        MISSING_CMDS+=("curl -fsSL https://get.docker.com | sh")
    fi
fi

# 4. 检查 ttyd (Web 终端)
if command -v ttyd &> /dev/null; then
    echo -e "${GREEN}✅ ttyd${NC}"
else
    echo -e "${RED}❌ ttyd${NC} - Web 终端 (局域网访问)"
    MISSING_DEPS+=("ttyd")
    # macOS 使用 Homebrew，Linux 使用包管理器
    if [[ "$OSTYPE" == "darwin"* ]]; then
        MISSING_CMDS+=("brew install ttyd")
    else
        MISSING_CMDS+=("sudo apt-get install -y ttyd || sudo yum install -y ttyd")
    fi
fi

# ============================================================
# 如果有缺失的依赖，询问用户
# ============================================================

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    echo ""
    echo "╔════════════════════════════════════════════════╗"
    echo "║  以下依赖缺失，需要安装:                        ║"
    echo "╠════════════════════════════════════════════════╣"
    for dep in "${MISSING_DEPS[@]}"; do
        printf "║  • %-42s ║\n" "$dep"
    done
    echo "╚════════════════════════════════════════════════╝"
    echo ""
    read -p "按 Enter 自动安装，其他键退出: " -n1 key
    echo ""

    if [ -z "$key" ]; then
        # 安装缺失的依赖
        for i in "${!MISSING_DEPS[@]}"; do
            dep="${MISSING_DEPS[$i]}"
            cmd="${MISSING_CMDS[$i]}"
            echo ""
            echo -e "${BLUE}正在安装 $dep...${NC}"
            eval "$cmd"
        done

        # 重新加载 PATH
        if [ -d "$HOME/.bun/bin" ]; then
            export BUN_INSTALL="$HOME/.bun"
            export PATH="$BUN_INSTALL/bin:$PATH"
        fi
        if [ -d "$HOME/.local/bin" ]; then
            export PATH="$HOME/.local/bin:$PATH"
        fi

        # 验证安装结果
        echo ""
        echo "验证安装结果..."
        INSTALL_FAILED=false

        if [[ " ${MISSING_DEPS[*]} " =~ " bun " ]]; then
            if command -v bun &> /dev/null; then
                echo -e "${GREEN}✅ bun 安装成功${NC}"
            else
                echo -e "${RED}❌ bun 安装失败${NC}"
                INSTALL_FAILED=true
            fi
        fi

        if [[ " ${MISSING_DEPS[*]} " =~ " uv " ]]; then
            if command -v uv &> /dev/null; then
                echo -e "${GREEN}✅ uv 安装成功${NC}"
            else
                echo -e "${RED}❌ uv 安装失败${NC}"
                INSTALL_FAILED=true
            fi
        fi

        if [[ " ${MISSING_DEPS[*]} " =~ " docker " ]]; then
            if command -v docker &> /dev/null; then
                echo -e "${GREEN}✅ docker 安装成功${NC}"
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    echo -e "${YELLOW}   请确保 Docker Desktop 已启动${NC}"
                fi
            else
                echo -e "${RED}❌ docker 安装失败${NC}"
                INSTALL_FAILED=true
            fi
        fi

        if [[ " ${MISSING_DEPS[*]} " =~ " ttyd " ]]; then
            if command -v ttyd &> /dev/null; then
                echo -e "${GREEN}✅ ttyd 安装成功${NC}"
            else
                echo -e "${RED}❌ ttyd 安装失败${NC}"
                INSTALL_FAILED=true
            fi
        fi

        if [ "$INSTALL_FAILED" = true ]; then
            echo ""
            echo -e "${RED}部分依赖安装失败，请手动安装后重试${NC}"
            exit 1
        fi
    else
        echo ""
        echo "已退出。手动安装命令:"
        for i in "${!MISSING_DEPS[@]}"; do
            echo "  ${MISSING_DEPS[$i]}: ${MISSING_CMDS[$i]}"
        done
        exit 0
    fi
fi

# ============================================================
# 最终检查 bun（必需）
# ============================================================

if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ bun 是必需依赖，无法继续${NC}"
    echo "   手动安装: curl -fsSL https://bun.sh/install | bash"
    exit 1
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

exec bun "$SCRIPT_DIR/packages/cli/src/index.tsx" "$@"
