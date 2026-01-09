import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Header, CascadeMenu, HelpPanel } from "./components/index.js";
import { menuTree } from "./menuData.js";
import { runCommand } from "./commands/index.js";

export function App() {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [subSelectedIndex, setSubSelectedIndex] = useState(0);
  const [focusLevel, setFocusLevel] = useState<"main" | "sub">("main");

  const currentItem = menuTree[selectedIndex];

  // 选中项有子菜单时自动展开
  const expandedId = currentItem?.children ? currentItem.id : null;

  const currentSubItem =
    expandedId && currentItem?.children
      ? currentItem.children[subSelectedIndex]
      : null;

  // 获取当前高亮项的 ID（用于 HelpPanel）
  const hoveredId =
    focusLevel === "sub" && currentSubItem
      ? currentSubItem.id
      : currentItem?.id || "";

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }

    if (focusLevel === "main") {
      // 主菜单导航
      if (key.upArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : menuTree.length - 1));
        setSubSelectedIndex(0);
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i < menuTree.length - 1 ? i + 1 : 0));
        setSubSelectedIndex(0);
      } else if (key.rightArrow && currentItem?.children) {
        // 移动焦点到子菜单
        setFocusLevel("sub");
      } else if (key.return || input === " ") {
        // 执行命令（仅叶子节点）
        if (!currentItem?.children) {
          exit();
          runCommand(currentItem.id);
        } else {
          // 有子菜单则移动焦点进去
          setFocusLevel("sub");
        }
      }
    } else {
      // 子菜单导航
      const children = currentItem?.children || [];
      if (key.upArrow) {
        setSubSelectedIndex((i) => (i > 0 ? i - 1 : children.length - 1));
      } else if (key.downArrow) {
        setSubSelectedIndex((i) => (i < children.length - 1 ? i + 1 : 0));
      } else if (key.leftArrow) {
        // 返回主菜单
        setFocusLevel("main");
      } else if (key.return || input === " ") {
        // 执行子命令
        if (currentSubItem) {
          exit();
          runCommand(currentSubItem.id);
        }
      }
    }
  });

  // 计算菜单区域需要的最小高度（主菜单项数 + 可能的子菜单高度）
  const maxSubMenuHeight = Math.max(
    ...menuTree.map((item) => (item.children?.length || 0) + 2) // +2 for border
  );
  const menuHeight = Math.max(menuTree.length, menuTree.length + maxSubMenuHeight - 3);

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="C4A v2 - 开发者 CLI" />

      <Box marginY={1} height={menuHeight}>
        <CascadeMenu
          items={menuTree}
          selectedIndex={selectedIndex}
          expandedId={expandedId}
          subSelectedIndex={subSelectedIndex}
          focusLevel={focusLevel}
        />
      </Box>

      <HelpPanel command={hoveredId} />

      <Box marginTop={1}>
        <Text dimColor>↑↓ 选择  →← 展开/收起  ␣/↵ 确认  q 退出</Text>
      </Box>
    </Box>
  );
}
