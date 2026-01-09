# @c4a/config-generator

C4A 统一配置生成器，将 `c4a.config.yaml` 转换为多种 Agent 基座的配置格式。

## 功能特性

- 统一配置格式，版本控制友好
- 支持生成 OpenCode、Claude SDK、Cursor 配置
- Zod Schema 验证，确保配置正确性
- 通配符工具名称自动展开

## 使用方式

### 配置文件

参考项目根目录的 `c4a.config.yaml` 作为配置示例。

配置 Schema 定义: [src/schema.ts](./src/schema.ts)

### 生成配置

```bash
# 生成所有平台配置
bun run packages/config-generator/src/index.ts

# 仅生成 OpenCode 配置
bun run packages/config-generator/src/index.ts --target opencode

# 预览生成内容（不写入文件）
bun run packages/config-generator/src/index.ts --dry-run
```

## 开发

```bash
# 测试
bun test packages/config-generator

# 类型检查
bunx tsc --noEmit -p packages/config-generator
```
