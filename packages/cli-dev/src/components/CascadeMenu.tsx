import React from "react";
import { Box, Text } from "ink";
import type { MenuItem } from "../menuData.js";

interface Props {
  items: MenuItem[];
  selectedIndex: number;
  expandedId: string | null;
  subSelectedIndex: number;
  focusLevel: "main" | "sub";
}

export function CascadeMenu({
  items,
  selectedIndex,
  expandedId,
  subSelectedIndex,
  focusLevel,
}: Props) {
  // 找到展开项的位置，用于定位悬浮子菜单
  const expandedIndex = items.findIndex((item) => item.id === expandedId);
  const expandedItem = expandedIndex >= 0 ? items[expandedIndex] : null;

  return (
    <Box position="relative">
      {/* 主菜单 */}
      <Box flexDirection="column">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const hasChildren = item.children && item.children.length > 0;

          return (
            <Box key={item.id} width={38}>
              <Text
                bold={isSelected && focusLevel === "main"}
                color={isSelected ? "cyan" : undefined}
              >
                {isSelected && focusLevel === "main" ? "▶ " : "  "}
                {item.label.padEnd(12)}
                {item.description}
                {hasChildren ? " →" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* 悬浮子菜单 */}
      {expandedItem?.children && (
        <Box
          position="absolute"
          marginLeft={39}
          marginTop={Math.max(0, expandedIndex - 1)}
          borderStyle="single"
          borderColor="cyan"
          flexDirection="column"
          paddingX={1}
        >
          {expandedItem.children.map((child, childIndex) => {
            const isChildSelected = childIndex === subSelectedIndex;
            return (
              <Text
                key={child.id}
                bold={isChildSelected && focusLevel === "sub"}
                color={isChildSelected ? "cyan" : undefined}
              >
                {isChildSelected && focusLevel === "sub" ? "▶ " : "  "}
                {child.label.padEnd(8)}
                {child.description}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
