/**
 * c4a_store_delete 工具实现
 *
 * 删除实体
 */
import type { StoreDeleteInput, StoreDeleteResult } from "../schemas.js";
import { getAdapter } from "@c4a/storage";
import { DataError, DATA_ERROR_CODES } from "@c4a/core/types";

/**
 * c4a_store_delete 处理函数
 *
 * 通过 StorageAdapter 接口访问存储，支持 Local/Server 两种模式。
 *
 * @param args - 输入参数
 * @returns 删除结果
 */
export async function storeDeleteHandler(args: StoreDeleteInput): Promise<StoreDeleteResult> {
  const adapter = await getAdapter();

  // 确保适配器已初始化
  await adapter.initialize();

  const entity = await adapter.readByUuid(args.uuid);
  if (!entity) {
    throw new DataError(
      DATA_ERROR_CODES.ENTITY_NOT_FOUND,
      {
        field: "uuid",
        expected: "已存在的实体 UUID",
        actual: args.uuid,
        suggestion: "请确认 uuid 是否正确",
      },
      "实体不存在"
    );
  }

  const targets = args.cascade
    ? await adapter.list({ root_id: entity.root_id ?? "", id: entity.id })
    : [entity];

  await adapter.transaction(async (tx) => {
    for (const target of targets) {
      if (target.uuid) {
        await tx.delete(target.uuid);
      }
    }
  });

  return {
    success: true,
    uuid: args.uuid,
    id: entity.id,
  };
}
