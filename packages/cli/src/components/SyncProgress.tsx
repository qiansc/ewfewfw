import React from "react";
import { Box, Text } from "ink";

export interface SyncProgressProps {
  current?: number;
  total?: number;
  message?: string;
  uploaded?: number;
  downloaded?: number;
  conflicts?: number;
}

export const SyncProgress: React.FC<SyncProgressProps> = ({
  current = 0,
  total = 0,
  message,
  uploaded = 0,
  downloaded = 0,
  conflicts = 0,
}) => {
  const progress =
    total > 0 ? `${current}/${total}` : current > 0 ? `${current}` : "0";

  return (
    <Box flexDirection="column">
      <Text>同步进度: {progress}</Text>
      <Text>
        ⬆️ 上传: {uploaded}  ⬇️ 下载: {downloaded}  ⚠️ 冲突: {conflicts}
      </Text>
      {message ? <Text color="gray">{message}</Text> : null}
    </Box>
  );
};
