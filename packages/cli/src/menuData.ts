import type { CliMode } from "./core/config.js";

export type MenuAction = "template";

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  command?: string[];
  action?: MenuAction;
  children?: MenuItem[];
  disabled?: boolean;
  disabledReason?: string;
}

export interface MenuContext {
  installedModes: Array<"local" | "server">;
  hasGlobalConfig: boolean;
  projectMode?: CliMode;
  remoteUrl?: string;
}

const SERVER_MENU: MenuItem[] = [
  { id: "server-status", label: "status   查看状态", command: ["server", "status"] },
  { id: "server-restart", label: "restart  重启服务", command: ["server", "restart"] },
  { id: "server-stop", label: "stop     停止服务", command: ["server", "stop"] },
  { id: "server-logs", label: "logs     查看日志", command: ["server", "logs"] },
  { id: "server-backup", label: "backup   备份数据", command: ["server", "backup"] },
  { id: "server-restore", label: "restore  恢复数据", command: ["server", "restore"] },
  { id: "server-clean", label: "clean    清理数据", command: ["server", "clean"] },
  {
    id: "server-check",
    label: "check-permissions 权限检查",
    command: ["server", "check-permissions"],
  },
];

const LOCAL_MENU: MenuItem[] = [
  { id: "local-status", label: "status   数据库状态", command: ["local", "status"] },
  { id: "local-validate", label: "validate 完整性校验", command: ["local", "validate"] },
  { id: "local-repair", label: "repair   修复数据", command: ["local", "repair"] },
  { id: "local-backup", label: "backup   备份数据", command: ["local", "backup"] },
  { id: "local-restore", label: "restore  恢复数据", command: ["local", "restore"] },
  { id: "local-clean", label: "clean    清理数据库", command: ["local", "clean"] },
  { id: "local-vacuum", label: "vacuum   压缩数据库", command: ["local", "vacuum"] },
];

export function buildFirstRunMenu(): MenuItem[] {
  return [
    {
      id: "first-skip",
      label: "continue 继续",
      description: "继续进入主菜单",
    },
  ];
}

function withDisabled(item: MenuItem, disabled: boolean, reason?: string): MenuItem {
  if (!disabled) return item;
  return {
    ...item,
    disabled: true,
    disabledReason: reason ?? "需要先初始化 local/server 或配置 remote 模式",
  };
}

export function buildMainMenu(context: MenuContext): MenuItem[] {
  const hasLocal = context.installedModes.includes("local");
  const hasServer = context.installedModes.includes("server");
  const hasInstalled = hasLocal || hasServer;
  const isRemoteProject = context.projectMode === "remote";

  const allowStatus = hasInstalled || isRemoteProject;

  const items: MenuItem[] = [
    {
      id: "init",
      label: "init 初始化项目",
      description: "创建 .context/ 目录和项目配置",
      command: ["init"],
    },
    withDisabled(
      {
        id: "status",
        label: "status 状态查看",
        description: "查看项目配置和数据库统计",
        command: ["status"],
      },
      !allowStatus,
    ),
    {
      id: "validate",
      label: "validate 验证 DSL",
      description: "离线校验 DSL 文件",
      command: ["validate"],
    },
    {
      id: "template",
      label: "template 生成模板",
      description: "生成 DSL 模板文件",
      action: "template",
    },
  ];

  if (hasServer) {
    items.push({
      id: "server",
      label: "server 服务管理",
      description: "管理 Docker 服务",
      children: SERVER_MENU,
    });
  }
  if (hasLocal) {
    items.push({
      id: "local",
      label: "local 本地管理",
      description: "管理本地数据库",
      children: LOCAL_MENU,
    });
  }

  items.push({
    id: "help",
    label: "help 帮助信息",
    description: "查看命令帮助",
    command: ["help"],
  });

  return items;
}
