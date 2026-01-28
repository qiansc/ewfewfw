/**
 * c4a_store_update_workflow_step 工具实现
 *
 * 原子更新 workflow 步骤状态，支持 Skills 错误恢复机制
 * 基于设计文档：v0.3.0/detailed-design/mcp/store-feat-checklist.md §3.9
 */
import type {
  StoreUpdateWorkflowStepInput,
  StoreUpdateWorkflowStepResult,
} from "../storeSchemas.js";
import { getAdapter } from "@c4a/core/store";

/**
 * c4a_store_update_workflow_step 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 * 提供 workflow_steps 的原子更新能力，避免并发覆盖风险。
 *
 * @param args - 输入参数
 * @returns 操作结果
 */
export async function storeUpdateWorkflowStepHandler(
  args: StoreUpdateWorkflowStepInput
): Promise<StoreUpdateWorkflowStepResult> {
  const adapter = getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  // 调用 StorageAdapter.updateWorkflowStep()
  const result = await adapter.updateWorkflowStep({
    feat_id: args.feat_id,
    step_id: args.step_id,
    status: args.status,
    metadata: args.metadata,
  });

  return result as StoreUpdateWorkflowStepResult;
}
