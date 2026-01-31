import React from "react";
import { Box, Text } from "ink";

export interface CascadeMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface CascadeMenuProps {
  items: CascadeMenuItem[];
  selectedIndex?: number;
}

export const CascadeMenu: React.FC<CascadeMenuProps> = ({ items, selectedIndex = 0 }) => {
  if (items.length === 0) {
    return <Text color="gray">暂无可用命令</Text>;
  }

  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const prefix = isSelected ? "▸" : " ";
        if (item.disabled) {
          return (
            <Text key={item.id} color="gray">
              {prefix} {item.label}
            </Text>
          );
        }
        return (
          <Text key={item.id} color={isSelected ? "cyan" : undefined} bold={isSelected}>
            {prefix} {item.label}
          </Text>
        );
      })}
    </Box>
  );
};
