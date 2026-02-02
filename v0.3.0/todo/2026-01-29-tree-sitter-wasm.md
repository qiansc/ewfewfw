# Tree-sitter WASM 分发最佳实践（延后至 v0.4.0）

> **状态**: ⏳ 延后
> **记录日期**: 2026-01-29
> **计划版本**: v0.4.0

- 目标：WASM 不放仓库，且不影响开发/Dev/Prod 使用。
- 方案要点：
  - 安装时下载到本地缓存（含 hash 校验）
  - 运行时支持 `C4A_TREE_SITTER_*` 覆盖路径
  - Docker/Prod 可内置或挂载 wasm 目录

## 当前实现 (v0.3.0)

使用 `packages/mcp-extract/scripts/copy-wasm.js` 在安装后从 node_modules 复制 WASM 文件。

**限制**：
- 语言 WASM 文件需要手动下载或构建
- 缺少 hash 校验
- 缺少环境变量覆盖支持
