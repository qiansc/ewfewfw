import React from "react";
import { Box, Text, useInput } from "ink";
import { CascadeMenu } from "./components/CascadeMenu.js";
import { loadGlobalConfig, loadProjectConfig, getInstalledModes } from "./core/config.js";
import {
  buildFirstRunMenu,
  buildMainMenu,
  type MenuAction,
  type MenuItem,
  type MenuContext,
} from "./menuData.js";

export type AppSelection =
  | { kind: "command"; command: string[] }
  | { kind: "action"; action: MenuAction }
  | { kind: "exit" };

interface AppProps {
  onSelect: (selection: AppSelection) => void;
}

type ViewState = "loading" | "first-run" | "menu" | "error";

export const App: React.FC<AppProps> = ({ onSelect }) => {
  const [context, setContext] = React.useState<MenuContext | null>(null);
  const [view, setView] = React.useState<ViewState>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [skipGuide, setSkipGuide] = React.useState(false);
  const [menuStack, setMenuStack] = React.useState<Array<{ title: string; items: MenuItem[] }>>([
    { title: "C4A CLI", items: [] },
  ]);
  const [indexStack, setIndexStack] = React.useState<number[]>([0]);

  const firstRunItems = React.useMemo(() => buildFirstRunMenu(), []);
  const mainMenuItems = React.useMemo(
    () => (context ? buildMainMenu(context) : []),
    [context],
  );

  React.useEffect(() => {
    let active = true;
    const loadContext = async () => {
      const globalConfig = await loadGlobalConfig();
      const projectConfig = await loadProjectConfig();
      const installedModes = getInstalledModes(globalConfig);
      const nextContext: MenuContext = {
        installedModes,
        hasGlobalConfig: Boolean(globalConfig),
        projectMode: projectConfig?.mode,
        remoteUrl: projectConfig?.remote?.url,
      };

      if (!active) return;
      setContext(nextContext);
      if (!globalConfig && !skipGuide) {
        setView("first-run");
      } else {
        setView("menu");
      }
    };

    loadContext().catch((err) => {
      if (!active) return;
      setError(String(err));
      setView("error");
    });

    return () => {
      active = false;
    };
  }, [skipGuide]);

  React.useEffect(() => {
    if (view === "first-run") {
      setMenuStack([{ title: "首次运行引导", items: firstRunItems }]);
      setIndexStack([0]);
      return;
    }
    if (view === "menu") {
      setMenuStack([{ title: "C4A CLI", items: mainMenuItems }]);
      setIndexStack([0]);
    }
  }, [view, firstRunItems, mainMenuItems]);

  const currentLevel = menuStack[menuStack.length - 1];
  const selectedIndex = indexStack[indexStack.length - 1] ?? 0;
  const currentItem = currentLevel?.items[selectedIndex];

  // 查找下一个可选中的项（跳过禁用项）
  const findNextEnabledIndex = (startIndex: number, direction: 1 | -1): number => {
    const items = currentLevel?.items ?? [];
    if (items.length === 0) return 0;

    let index = startIndex;
    let attempts = 0;
    while (attempts < items.length) {
      if (!items[index]?.disabled) {
        return index;
      }
      index = (index + direction + items.length) % items.length;
      attempts++;
    }
    return startIndex; // 全部禁用时保持原位
  };

  const updateSelectedIndex = (nextIndex: number) => {
    setIndexStack((prev) => {
      const next = [...prev];
      next[next.length - 1] = nextIndex;
      return next;
    });
  };

  const popMenu = () => {
    if (menuStack.length <= 1) return;
    setMenuStack((prev) => prev.slice(0, -1));
    setIndexStack((prev) => prev.slice(0, -1));
  };

  const pushMenu = (title: string, items: MenuItem[]) => {
    setMenuStack((prev) => [...prev, { title, items }]);
    setIndexStack((prev) => [...prev, 0]);
  };

  const handleSelect = React.useCallback((item?: MenuItem) => {
    if (!item || item.disabled) return;

    if (view === "first-run") {
      if (item.id === "first-skip") {
        setSkipGuide(true);
        setView("menu");
        return;
      }
      if (item.command) {
        onSelect({ kind: "command", command: item.command });
      }
      return;
    }

    if (item.children && item.children.length > 0) {
      pushMenu(item.label, item.children);
      return;
    }

    if (item.command) {
      onSelect({ kind: "command", command: item.command });
      return;
    }

    if (item.action) {
      onSelect({ kind: "action", action: item.action });
    }
  }, [onSelect, view]);


  useInput(
    (input, key) => {
      if (view === "loading" || view === "error") return;
      if (input === "q") {
        onSelect({ kind: "exit" });
        return;
      }

      const itemCount = currentLevel?.items.length ?? 0;
      if (itemCount === 0) return;

      if (key.upArrow) {
        const nextIndex = (selectedIndex - 1 + itemCount) % itemCount;
        updateSelectedIndex(findNextEnabledIndex(nextIndex, -1));
        return;
      }
      if (key.downArrow) {
        const nextIndex = (selectedIndex + 1) % itemCount;
        updateSelectedIndex(findNextEnabledIndex(nextIndex, 1));
        return;
      }
      if (key.leftArrow || key.backspace) {
        popMenu();
        return;
      }
      if (key.return || key.rightArrow) {
        handleSelect(currentItem);
      }
    },
  );

  const helperText =
    currentItem?.disabled && currentItem.disabledReason
      ? currentItem.disabledReason
      : currentItem?.description;

  const hasInstalled = context?.hasGlobalConfig ?? false;
  const remoteHint =
    context?.projectMode === "remote" && context.remoteUrl
      ? `远程服务: ${context.remoteUrl}`
      : null;

  // 面包屑导航
  const breadcrumb = menuStack.map((level) => level.title).join(" > ");
  const isInSubmenu = menuStack.length > 1;

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">{breadcrumb}</Text>
        {view === "first-run" ? <Text color="gray"> - 首次运行引导</Text> : null}
      </Box>
      {view === "loading" ? (
        <Box marginTop={1}>
          <Text color="gray">正在加载配置...</Text>
        </Box>
      ) : null}
      {view === "error" ? (
        <Box marginTop={1}>
          <Text color="red">加载失败: {error}</Text>
        </Box>
      ) : null}
      {view === "first-run" ? (
        <Box marginTop={1}>
          <Text>检测到尚未配置存储模式，可继续进入主菜单:</Text>
        </Box>
      ) : null}
      {view === "menu" ? (
        <Box marginTop={1} flexDirection="column">
          {!hasInstalled ? (
            <Text color="yellow">⚠ 尚未配置任何存储模式</Text>
          ) : null}
          {remoteHint ? <Text color="gray">{remoteHint}</Text> : null}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <CascadeMenu
          items={(currentLevel?.items ?? []).map((item) => ({
            id: item.id,
            label: item.children?.length ? `${item.label} ▶` : item.label,
            disabled: item.disabled,
          }))}
          selectedIndex={selectedIndex}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">─────────────────────────────────</Text>
      </Box>
      {helperText ? (
        <Box>
          <Text color="gray">{helperText}</Text>
        </Box>
      ) : null}
      <Box marginTop={helperText ? 0 : 1}>
        <Text color="gray" dimColor>
          ↑/↓ 选择  Enter 确认  {isInSubmenu ? "← 返回  " : ""}q 退出
        </Text>
      </Box>
    </Box>
  );
};
