import React from "react";
import { Box, Text } from "ink";

interface Props {
  title: string;
}

/**
 * 计算字符串的显示宽度（中文字符占2个宽度）
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    // 中日韩字符和全角字符占2个宽度
    if (char.charCodeAt(0) > 0x7f) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 用空格填充到指定显示宽度
 */
function padToWidth(str: string, targetWidth: number): string {
  const currentWidth = getDisplayWidth(str);
  const padCount = targetWidth - currentWidth;
  return str + " ".repeat(Math.max(0, padCount));
}

export function Header({ title }: Props) {
  const width = 50;
  const border = "═".repeat(width - 2);
  const innerWidth = width - 4; // 减去 "║ " 和 " ║"

  return (
    <Box flexDirection="column">
      <Text color="cyan">╔{border}╗</Text>
      <Text color="cyan">
        ║ <Text bold>{padToWidth(title, innerWidth)}</Text> ║
      </Text>
      <Text color="cyan">╚{border}╝</Text>
    </Box>
  );
}
