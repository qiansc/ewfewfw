/**
 * c4a_store_*_version 工具实现
 */
import type {
  StoreAddVersionInput,
  StoreAddVersionResult,
  StoreRemoveVersionInput,
  StoreRemoveVersionResult,
  StorePublishVersionInput,
  StorePublishVersionResult,
} from "../schemas.js";
import {
  StoreAddVersionInputSchema,
  StoreRemoveVersionInputSchema,
  StorePublishVersionInputSchema,
} from "../schemas.js";
import { getAdapter } from "@c4a/storage";
import {
  DataError,
  DATA_ERROR_CODES,
  VersionError,
  VERSION_ERROR_CODES,
} from "@c4a/core/types";

const LATEST_VERSION = "0.0.0";

type StableVersion = { major: number; minor: number; patch: number; raw: string };

function parseStableVersion(version: string): StableVersion | null {
  if (version.includes("-")) return null;
  const parts = version.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => Number.isNaN(num))) return null;
  return { major: nums[0], minor: nums[1], patch: nums[2], raw: version };
}

function compareStable(a: StableVersion, b: StableVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function ensureNotLatest(version: string): void {
  if (version === LATEST_VERSION) {
    throw new VersionError(
      VERSION_ERROR_CODES.CANNOT_ADD_LATEST,
      {
        field: "version",
        expected: "非 0.0.0 的 SemVer",
        actual: version,
        suggestion: "0.0.0 为 latest 指针，仅可通过 publish 自动转移",
      },
      "不允许手动添加 0.0.0"
    );
  }
}

function pickHighestStable(versions: string[]): string | null {
  const stable = versions
    .map(parseStableVersion)
    .filter((value): value is StableVersion => Boolean(value));
  if (stable.length === 0) return null;
  stable.sort(compareStable);
  return stable[stable.length - 1]?.raw ?? null;
}

/**
 * c4a_store_add_version
 */
export async function storeAddVersionHandler(
  args: StoreAddVersionInput
): Promise<StoreAddVersionResult> {
  const parsed = StoreAddVersionInputSchema.parse(args);
  ensureNotLatest(parsed.version);

  const adapter = await getAdapter();
  await adapter.initialize();

  const entity = await adapter.readByUuid(parsed.uuid);
  if (!entity) {
    throw new DataError(
      DATA_ERROR_CODES.ENTITY_NOT_FOUND,
      { field: "uuid", expected: "已存在的实体 UUID", actual: parsed.uuid },
      "实体不存在"
    );
  }

  const existingVersions = entity.versions ?? [];
  if (existingVersions.includes(parsed.version)) {
    return {
      success: true,
      entity_uuid: parsed.uuid,
      versions: existingVersions,
      warning: `版本 ${parsed.version} 已存在，未重复添加`,
    };
  }

  const updated = await adapter.addVersion(parsed.uuid, parsed.version);
  return {
    success: true,
    entity_uuid: parsed.uuid,
    versions: updated.versions ?? [],
  };
}

/**
 * c4a_store_remove_version
 */
export async function storeRemoveVersionHandler(
  args: StoreRemoveVersionInput
): Promise<StoreRemoveVersionResult> {
  const parsed = StoreRemoveVersionInputSchema.parse(args);

  const adapter = await getAdapter();
  await adapter.initialize();

  const entity = await adapter.readByUuid(parsed.uuid);
  if (!entity) {
    throw new DataError(
      DATA_ERROR_CODES.ENTITY_NOT_FOUND,
      { field: "uuid", expected: "已存在的实体 UUID", actual: parsed.uuid },
      "实体不存在"
    );
  }

  const versions = entity.versions ?? [];
  if (!versions.includes(parsed.version)) {
    throw new VersionError(
      VERSION_ERROR_CODES.VERSION_NOT_FOUND,
      {
        field: "version",
        expected: "实体包含的版本号",
        actual: parsed.version,
        suggestion: "请先通过 c4a_store_read 查看实体版本",
      },
      "版本不存在于该实体"
    );
  }

  if (parsed.version === LATEST_VERSION) {
    const autoFallback = pickHighestStable(versions.filter((v) => v !== LATEST_VERSION));
    const fallbackVersion = parsed.fallback_version ?? autoFallback ?? undefined;
    if (!fallbackVersion) {
      throw new VersionError(
        VERSION_ERROR_CODES.NO_FALLBACK_VERSION,
        {
          field: "fallback_version",
          expected: "可回退的正式版本",
          actual: "",
          suggestion: "请先发布至少一个正式版本后再移除 0.0.0",
        },
        "无法移除 0.0.0，没有可回退的正式版本"
      );
    }

    const updated = await adapter.removeVersion(parsed.uuid, LATEST_VERSION);
    const targetEntities = await adapter.list({
      root_id: entity.root_id ?? "",
      id: entity.id,
      version: fallbackVersion,
    });
    const target = targetEntities[0];
    if (!target?.uuid) {
      throw new DataError(
        DATA_ERROR_CODES.ENTITY_NOT_FOUND,
        {
          field: "fallback_version",
          expected: "存在该版本的实体",
          actual: fallbackVersion,
        },
        "未找到回退版本对应的实体"
      );
    }
    await adapter.addVersion(target.uuid, LATEST_VERSION);

    return {
      success: true,
      entity_uuid: parsed.uuid,
      versions: updated.versions ?? [],
      deleted: (updated.versions ?? []).length === 0,
      latest_fallback: {
        previous_latest: fallbackVersion,
        target_uuid: target.uuid,
      },
    };
  }

  const updated = await adapter.removeVersion(parsed.uuid, parsed.version);
  return {
    success: true,
    entity_uuid: parsed.uuid,
    versions: updated.versions ?? [],
    deleted: (updated.versions ?? []).length === 0,
  };
}

/**
 * c4a_store_publish_version
 */
export async function storePublishVersionHandler(
  args: StorePublishVersionInput
): Promise<StorePublishVersionResult> {
  const parsed = StorePublishVersionInputSchema.parse(args);

  const adapter = await getAdapter();
  await adapter.initialize();

  const isPrerelease = parsed.version.includes("-");
  const transferLatest = parsed.transfer_latest ?? !isPrerelease;

  const entities = await adapter.list({ root_id: parsed.root_id, version: LATEST_VERSION });
  if (entities.length === 0) {
    throw new DataError(
      DATA_ERROR_CODES.ENTITY_NOT_FOUND,
      {
        field: "root_id",
        expected: "存在可发布实体的 root_id",
        actual: parsed.root_id,
      },
      "没有找到可发布的实体"
    );
  }

  const warnings: string[] = [];
  for (const entity of entities) {
    if (!entity.uuid) continue;
    const versions = entity.versions ?? [];
    if (versions.includes(parsed.version)) {
      warnings.push(`实体 ${entity.uuid} 已包含版本 ${parsed.version}，跳过`);
      continue;
    }
    await adapter.addVersion(entity.uuid, parsed.version);
  }

  if (!transferLatest) {
    const allVersions = await adapter.listVersions(parsed.root_id);
    const previousStable = pickHighestStable(
      allVersions.filter((v) => v !== LATEST_VERSION && v !== parsed.version && !v.includes("-"))
    );

    if (previousStable) {
      for (const entity of entities) {
        if (entity.uuid) {
          await adapter.removeVersion(entity.uuid, LATEST_VERSION);
        }
      }
      const stableEntities = await adapter.list({
        root_id: parsed.root_id,
        version: previousStable,
      });
      for (const entity of stableEntities) {
        if (entity.uuid) {
          await adapter.addVersion(entity.uuid, LATEST_VERSION);
        }
      }
    }
  }

  return {
    success: true,
    root_id: parsed.root_id,
    version: parsed.version,
    affected_entities: entities.length,
    latest_transferred: transferLatest,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
