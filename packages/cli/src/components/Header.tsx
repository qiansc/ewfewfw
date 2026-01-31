import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  title: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      {subtitle ? <Text color="gray">{subtitle}</Text> : null}
    </Box>
  );
};
