# Part 09: 开发者 CLI - 实施计划

> 执行顺序：顺序执行，无需多 Agent

---

## 概述

Part 09 聚焦于开发者 CLI (`./start.sh`) 的完善，对照设计文档补齐缺失功能。

**现状分析**：

| 功能 | 设计文档 | 现有实现 | 状态 |
|------|:--------:|:--------:|:----:|
| 交互式菜单 | ✅ | ✅ | 已完成 |
| `dev` 命令 | ✅ | ✅ | 已完成 |
| `docker` 命令 | ✅ | ✅ | 已完成 |
| `prod` 命令 | ✅ | ✅ | 已完成 |
| `debug:*` 命令 | ✅ | ✅ | 已完成 |
| `server` 子菜单 | ✅ | ✅ | 已完成 |
| `build` 命令 | ✅ | ❌ | **待实现** |
| `build --publish` | ✅ | ❌ | **待实现** |
| 延迟依赖检查 | ✅ | ⚠️ | **需优化** |
| `install` 命令 | ✅ | ✅ | 已完成 |
| `test` 命令 | ✅ | ✅ | 已完成 |
| `clean` 子菜单 | ✅ | ✅ | 已完成 |

**结论**：主要缺失 `build` 命令和延迟依赖检查优化。

---

## 任务清单

| # | 任务 | 描述 | 状态 |
|---|------|------|:----:|
| 9.1 | `build` 命令实现 | 编译用户 CLI + 打包 Skills | [ ] |
| 9.2 | `build --publish` | npm 发布流程 | [ ] |
| 9.3 | 延迟依赖检查 | 按需检查依赖，移除 start.sh 前置检查 | [ ] |
| 9.4 | 菜单更新 | 添加 build 到菜单 | [ ] |
| 9.5 | 验证与测试 | 手动验证所有命令 | [ ] |

---

## 任务 9.1: `build` 命令实现

**目标**：编译用户 CLI，打包 Skills、MCP 工具和运行时资源。

**设计文档参考**：`v0.3.0/detailed-design/cli/dev-cli.md` §3.3

**执行流程**：

```
$ ./start.sh build

  编译用户 CLI

1. 编译 TypeScript
   ✅ packages/cli/src/ → packages/cli/dist/

2. 打包 Skills
   ✅ prompts/skills/ → packages/cli/dist/skills/

3. MCP 工具依赖 (通过 workspace 依赖，由 bun build 自动打包)
   ✅ @c4a/mcp-extract (workspace:*) → 打包进 dist
   ✅ @c4a/mcp-store (workspace:*) → 打包进 dist

4. 复制资源文件
   ✅ JSON Schema → packages/cli/dist/schemas/
   ✅ embedding 模型配置 → packages/cli/dist/models/
   ✅ WASM 解析器 → packages/cli/dist/wasm/
      (源路径: packages/mcp-extract/wasm/*.wasm)

5. 生成 package.json (清理 workspace 依赖)
   ✅ packages/cli/dist/package.json

6. 设置可执行权限
   ✅ chmod +x packages/cli/dist/index.js

✅ 编译完成

输出目录: packages/cli/dist/
大小: ~15 MB (含 WASM)

测试:
  cd packages/cli/dist && npm link
  c4a --version
```

**打包策略说明**：

MCP 工具（mcp-extract、mcp-store）通过 `workspace:*` 依赖引入，由 `bun build` 进行 Tree-shaking 和打包。**打包后不再依赖 workspace**，所有 `@c4a/*` 代码都被内联到输出文件中。

**关键：dist/package.json 生成逻辑**：

生成 `dist/package.json` 时，必须：
1. **移除已被打包的 workspace 依赖**：`@c4a/core`、`@c4a/storage`、`@c4a/mcp-extract`、`@c4a/mcp-store`
2. **保留未被打包的外部运行时依赖**：如 `ink`、`react`、`commander` 等
3. **替换 workspace:* 为具体版本号**：如果有未打包的 workspace 依赖

```typescript
// 示例：生成 dist/package.json
const srcPkg = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf-8'));
const distPkg = {
  name: srcPkg.name,
  version: srcPkg.version,
  bin: { c4a: './index.js' },
  dependencies: {
    // 仅保留外部运行时依赖，移除所有 @c4a/* 依赖
    ink: srcPkg.dependencies.ink,
    react: srcPkg.dependencies.react,
    // ...
  },
};
fs.writeFileSync('packages/cli/dist/package.json', JSON.stringify(distPkg, null, 2));
```

**WASM 文件说明**：

mcp-extract 依赖 tree-sitter 的 WASM 文件进行代码解析：
- `tree-sitter.wasm` - 核心解析器
- `tree-sitter-go.wasm` - Go 语言支持
- `tree-sitter-python.wasm` - Python 语言支持
- `tree-sitter-typescript.wasm` - TypeScript 语言支持

User CLI 在 Local 模式下运行代码分析时必须能加载这些文件。

**WASM 路径适配**：

在 `packages/cli/src/index.tsx` 入口处，需检测运行时环境并设置 WASM 路径。

> **注意**：CLI 使用 ESM（`"type": "module"`），`__dirname` 在 ESM 中不可用，需使用 `import.meta.url` 派生路径。

```typescript
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ESM 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 检测是否为生产构建（dist 目录）
const isProduction = __dirname.includes('/dist');
if (isProduction) {
  // 设置 WASM 路径指向同级 wasm/ 目录
  process.env.TREE_SITTER_WASM_PATH = join(__dirname, 'wasm');
}
```

**实现步骤**：

1. 确保 `packages/cli/package.json` 包含 workspace 依赖（开发时使用）：
   ```json
   {
     "dependencies": {
       "@c4a/core": "workspace:*",
       "@c4a/storage": "workspace:*",
       "@c4a/mcp-extract": "workspace:*",
       "@c4a/mcp-store": "workspace:*"
     }
   }
   ```

2. 在 `packages/cli-dev/src/commands/index.ts` 添加 `cmdBuild()` 函数

3. 实现编译流程：
   - 调用 `bun build` 编译 TypeScript（自动打包 workspace 依赖）
   - 复制 `prompts/skills/` 到 `dist/skills/`
   - 复制 `packages/core/src/schemas/` 到 `dist/schemas/`
   - 复制 `packages/mcp-extract/wasm/*.wasm` 到 `dist/wasm/`
   - 生成 `dist/package.json`（**移除 @c4a/* 依赖**）
   - 执行 `chmod +x dist/index.js`

4. 在 `packages/cli/src/index.tsx` 添加 WASM 路径检测逻辑

5. 显示编译结果（目录大小、文件数）

**允许修改的文件**：
- `packages/cli-dev/src/commands/index.ts`（扩展）
- `packages/cli-dev/src/commands/build.ts`（新建，可选拆分）
- `packages/cli/package.json`（确保 workspace 依赖）
- `packages/cli/src/index.tsx`（添加 WASM 路径检测）

---

## 任务 9.2: `build --publish`

**目标**：编译并发布到 npm。

**实现步骤**：

1. 检测 `--publish` 参数
2. 执行 build 流程
3. 验证 `dist/package.json` 不包含 `workspace:*` 依赖
4. 交互式确认版本号
5. 执行 `npm publish packages/cli/dist/`

**注意**：
- 发布需要 npm 登录，失败时给出明确提示
- 如果 `dist/package.json` 包含 `workspace:*`，npm publish 会失败

---

## 任务 9.3: 延迟依赖检查

**目标**：按需检查依赖，避免不必要的前置检查。

**现状分析**：

| 位置 | 现有行为 | 设计要求 |
|------|---------|---------|
| `start.sh` L36-182 | 前置检查 bun/uv/docker/ttyd + 自动安装 | 仅保留 bun 必需检查 |
| `index.tsx` | 无前置检查 | 无前置检查 ✅ |
| `commands/index.ts` | 各命令内部调用 `checkDependencies()` | 各命令按需检查 ✅ |

**设计文档参考**：`v0.3.0/detailed-design/cli/dev-cli.md` §3.4

**⚠️ 行为变化说明**：

移除 `start.sh` 前置检查后，以下能力将被取消：
- **自动安装依赖**：不再自动安装 bun/uv/docker/ttyd
- **安装后验证**：不再验证安装结果

用户需要手动安装缺失的依赖，CLI 会在需要时给出安装提示。

**检查时机**（按实际实现）：

| 命令 | 必需依赖 | 可选依赖 | 说明 |
|------|---------|---------|------|
| `dev` | docker, bun | uv | uv 缺失仅警告 |
| `docker` | docker | | |
| `prod` | docker | | |
| `debug:dsl` | bun | | |
| `debug:code` | bun | | |
| `debug:data` | bun | | 当前实现用 bun 运行 mcp-query |
| `build` | bun | | |
| `install` | bun | uv | uv 缺失仅警告 |
| `test` | bun | | |
| `status/stop/logs` | 无 | | |
| `clean:*` | 无 | docker | docker 缺失仅警告 |

> **设计与实现差异**：设计文档中 `debug:data` 依赖 uv，但当前实现是 `bun run packages/mcp-query/src/index.ts`，实际依赖 bun。如果未来 mcp-query 改用 Python，需调整为 uv。

**uv 检查策略**：

uv 在所有命令中都作为**可选依赖**处理（统一策略）：
- 检查失败时仅警告，**不阻断**命令执行
- 提示用户 Python 相关功能不可用
- 给出安装命令

```typescript
if (deps.includes("uv")) {
  if (checkUv()) {
    success("uv 已安装");
  } else {
    warn("uv 未安装，Python 功能不可用");
    warn("安装: curl -LsSf https://astral.sh/uv/install.sh | sh");
    // 不阻断，继续执行
  }
}
```

**实现步骤**：

1. 精简 `start.sh`：
   - 移除前置依赖检查逻辑（L36-182 的 bun/uv/docker/ttyd 检查和自动安装）
   - 保留 PATH 设置（L14-31）
   - 保留 bun 最终检查（L188-192，必需）
   - 保留首次运行 `bun install`（L198-203）

2. 确认 `commands/index.ts` 的依赖检查：
   - `cmdDev()`: 修改为 `checkDependencies(["docker", "bun"], ["uv"])`（uv 可选）
   - `cmdDebugData()`: 当前用 bun，无需改动
   - `cmdInstall()`: 修改为 `checkDependencies(["bun"], ["uv"])`（uv 可选）

3. 扩展 `checkDependencies()` 支持可选依赖参数：
   ```typescript
   async function checkDependencies(
     required: string[],
     optional: string[] = []
   ): Promise<boolean> {
     // required 依赖缺失则阻断
     // optional 依赖缺失仅警告
   }
   ```

**允许修改的文件**：
- `start.sh`（精简前置检查）
- `packages/cli-dev/src/commands/index.ts`（确认/补齐依赖检查）
- `packages/cli-dev/src/utils/process.ts`（添加 `checkUv()` 如不存在）

---

## 任务 9.4: 菜单更新

**目标**：在交互式菜单中添加 `build` 选项。

**实现步骤**：

1. 在 `menuData.ts` 的 `menuTree` 中添加 `build` 项
2. 在 `helpDescriptions` 中添加 `build` 说明
3. 在 `commands/index.ts` 的 `runCommand` switch 中添加 `build` case

**允许修改的文件**：
- `packages/cli-dev/src/menuData.ts`

---

## 任务 9.5: 验证与测试

**验证清单**：

```bash
# 1. 交互式菜单
./start.sh
# 验证：菜单显示正常，build 选项可见

# 2. build 命令
./start.sh build
# 验证：
#   - 编译成功，输出目录存在
#   - dist/package.json 不包含 workspace:* 依赖
#   - dist/wasm/ 包含 WASM 文件
#   - dist/index.js 有可执行权限

# 3. 延迟依赖检查
./start.sh test
# 验证：不检查 docker/uv，直接运行测试

# 4. 各命令正常
./start.sh status
./start.sh stop
./start.sh install

# 5. npm link 测试
cd packages/cli/dist && npm link
c4a --version
```

---

## 执行检查清单

| 步骤 | 任务 | 产物 | 状态 |
|------|------|------|:----:|
| 1 | `build` 命令 | commands/index.ts 扩展 | [ ] |
| 2 | `build --publish` | npm 发布流程 | [ ] |
| 3 | 延迟依赖检查 | start.sh 精简 | [ ] |
| 4 | 菜单更新 | menuData.ts 扩展 | [ ] |
| 5 | 验证测试 | 手动验证通过 | [ ] |

---

## 产物清单

| 文件 | 说明 | 操作 |
|------|------|------|
| `packages/cli-dev/src/commands/index.ts` | 添加 cmdBuild + 确认依赖检查 | 扩展 |
| `packages/cli-dev/src/menuData.ts` | 添加 build 菜单项 | 扩展 |
| `packages/cli-dev/src/utils/process.ts` | 添加 checkUv() | 扩展 |
| `packages/cli/package.json` | 确保 workspace 依赖 | 检查/扩展 |
| `packages/cli/src/index.tsx` | 添加 WASM 路径检测 | 扩展 |
| `start.sh` | 移除前置依赖检查和自动安装 | 精简 |

---

## 与其他 Part 的关系

| Part | 关系 | 说明 |
|------|------|------|
| Part 08 | 依赖 | 用户 CLI (`packages/cli`) 是 build 的输入 |
| Part 10 | 依赖 | Skills (`prompts/skills/`) 需要打包到 dist |
| Part 12 | 被依赖 | 发布流程是 Release 的一部分 |

---

## 风险与注意事项

1. **npm 发布权限**：`build --publish` 需要 npm 登录，首次使用需配置
2. **Skills 路径**：打包时需确保 Skills 的相对路径引用正确
3. **Schema 版本**：打包的 Schema 需与 @c4a/core 版本一致
4. **向后兼容**：start.sh 精简后，自动安装依赖的能力会被取消
5. **WASM 文件路径**：User CLI 运行时需正确定位 WASM 文件，通过入口检测设置环境变量
6. **workspace 依赖清理**：dist/package.json 必须移除 `@c4a/*` 依赖，否则 npm publish 会失败
7. **可执行权限**：bun build 生成的文件默认无执行权限，需手动 chmod +x
