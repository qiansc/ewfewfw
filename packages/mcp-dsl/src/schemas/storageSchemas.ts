/**
 * 本地存储工具 Input Schema 定义
 *
 * 命名规范: c4a_local_{verb}_{object}
 */
import { z } from "zod";

// 通用类型定义
const DSLTypeEnum = z.enum(["system", "container", "component", "adr"]);
const StatusFilterEnum = z.enum(["draft", "approved", "published", "archived", "all"]);
const TypeFilterEnum = z.enum(["system", "container", "component", "adr", "all"]);
const TransitionStatusEnum = z.enum(["approved", "published", "deprecated", "archived"]);

// c4a_local_init_repo - 初始化目录
export const InitRepoInputSchema = z.object({
  project_path: z
    .string()
    .optional()
    .default(".")
    .describe("项目根目录路径"),
});

// c4a_local_list_files - 列出文件
export const ListFilesInputSchema = z.object({
  status: StatusFilterEnum
    .optional()
    .default("all")
    .describe("按状态筛选"),
  type: TypeFilterEnum
    .optional()
    .default("all")
    .describe("按类型筛选"),
  project_path: z
    .string()
    .optional()
    .default(".")
    .describe("项目根目录"),
});

// c4a_local_read_file - 读取 DSL
export const ReadFileInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("DSL 文件路径 (相对于项目根目录)"),
  id: z
    .string()
    .optional()
    .describe("DSL ID (与 type 配合使用)"),
  type: DSLTypeEnum
    .optional()
    .describe("DSL 类型 (与 id 配合使用)"),
  project_path: z
    .string()
    .optional()
    .default(".")
    .describe("项目根目录"),
});

// c4a_local_write_file - 写入 DSL
export const WriteFileInputSchema = z.object({
  path: z
    .string()
    .describe("目标路径 (相对于项目根目录)"),
  content: z
    .union([z.string(), z.record(z.unknown())])
    .describe("DSL 内容 (对象或 YAML 字符串)"),
  validate: z
    .boolean()
    .optional()
    .default(true)
    .describe("是否验证 (默认 true)"),
  overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe("是否覆盖已存在文件 (默认 false)"),
  project_path: z
    .string()
    .optional()
    .default(".")
    .describe("项目根目录"),
});

// c4a_local_transition_status - 状态流转
export const TransitionStatusInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("当前 DSL 文件路径"),
  id: z
    .string()
    .optional()
    .describe("DSL ID (与 type 配合使用)"),
  type: DSLTypeEnum
    .optional()
    .describe("DSL 类型"),
  to_status: TransitionStatusEnum
    .describe("目标状态"),
  metadata: z
    .object({
      approved_by: z.string().optional().describe("批准人"),
      reviewers: z.array(z.string()).optional().describe("评审人列表"),
      reason: z.string().optional().describe("流转原因"),
    })
    .optional()
    .describe("附加元数据"),
  project_path: z
    .string()
    .optional()
    .default(".")
    .describe("项目根目录"),
});

// 导出类型
export type InitRepoInput = z.infer<typeof InitRepoInputSchema>;
export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;
export type TransitionStatusInput = z.infer<typeof TransitionStatusInputSchema>;

// 类型别名 (兼容旧 import)
export type InitInput = InitRepoInput;
export type ListInput = ListFilesInput;
export type ReadInput = ReadFileInput;
export type WriteInput = WriteFileInput;
export type TransitionInput = TransitionStatusInput;
