from __future__ import annotations

"""
权限校验依赖（统一出口）

当前使用 FastAPI Depends 进行权限校验，此模块提供集中导入入口，
避免散落在各 route 中重复声明。
"""

from ..dependencies import (
    check_entity_permission,
    check_read_permission,
    check_relation_permission,
    require_approve_permission,
    require_write_permission,
)

__all__ = [
    "check_entity_permission",
    "check_read_permission",
    "check_relation_permission",
    "require_approve_permission",
    "require_write_permission",
]
