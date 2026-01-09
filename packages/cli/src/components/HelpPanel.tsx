import React from "react";
import { Box, Text } from "ink";
import { helpDescriptions } from "../menuData.js";

interface Props {
  command: string;
}

export function HelpPanel({ command }: Props) {
  const description = helpDescriptions[command] || "选择一个命令查看说明。";

  return (
    <Box paddingX={1}>
      <Text dimColor>{description}</Text>
    </Box>
  );
}
