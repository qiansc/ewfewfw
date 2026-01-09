# C4A DSL Schemas

C4A DSL 的 JSON Schema 定义，用于校验 YAML 格式的架构描述文件。

## 文件列表

| Schema | type 值 | 说明 |
|--------|---------|------|
| c4a-common.schema.json | - | 共享类型定义 |
| c4a-system.schema.json | `software-system` | 系统层 |
| c4a-container.schema.json | `container` | 容器层 |
| c4a-component.schema.json | `component` | 组件层 |
| c4a-adr.schema.json | `adr` | 架构决策记录 |
| c4a-contract.schema.json | `contract` | API 契约 |
| c4a-constraints.schema.json | `constraints` | SLA/安全/合规约束 |
| c4a-risks.schema.json | `risks` | 风险和技术债 |
| c4a-history.schema.json | `history` | 版本演进记录 |

## Schema 版本

当前版本: `c4a/v1`

## 使用方式

```python
import json
from jsonschema import validate

# 加载 Schema
with open("c4a-system.schema.json") as f:
    schema = json.load(f)

# 验证 YAML 数据
validate(instance=yaml_data, schema=schema)
```
