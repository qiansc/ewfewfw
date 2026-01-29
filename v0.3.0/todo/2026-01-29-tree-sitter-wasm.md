# Tree-sitter WASM 分发最佳实践（下版本实现）

- 目标：WASM 不放仓库，且不影响开发/Dev/Prod 使用。
- 方案要点：
  - 安装时下载到本地缓存（含 hash 校验）
  - 运行时支持 `C4A_TREE_SITTER_*` 覆盖路径
  - Docker/Prod 可内置或挂载 wasm 目录
- 时点：2026-01-29 记录，安排至下个版本实现。
