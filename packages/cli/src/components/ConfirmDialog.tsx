import React from "react";
import { Box, Text } from "ink";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  hint?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  hint,
}) => {
  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      <Text>{message}</Text>
      {hint ? <Text color="gray">{hint}</Text> : null}
    </Box>
  );
};
