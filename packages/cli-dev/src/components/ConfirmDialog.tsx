import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

interface ConfirmDialogProps {
  title: string;
  message: string;
  items?: string[];
  warning?: string;
  onConfirm: (confirmed: boolean) => void;
}

function ConfirmDialogComponent({
  title,
  message,
  items,
  warning,
  onConfirm,
}: ConfirmDialogProps) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(1); // 0 = Yes, 1 = No (default No)

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setSelected((s) => (s === 0 ? 1 : 0));
    } else if (key.return || input === " ") {
      exit();
      onConfirm(selected === 0);
    } else if (input === "y" || input === "Y") {
      exit();
      onConfirm(true);
    } else if (input === "n" || input === "N" || input === "q") {
      exit();
      onConfirm(false);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          ⚠️  {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      {items && items.length > 0 && (
        <Box flexDirection="column" marginBottom={1} marginLeft={2}>
          {items.map((item, index) => (
            <Text key={index} dimColor>
              • {item}
            </Text>
          ))}
        </Box>
      )}

      {warning && (
        <Box marginBottom={1}>
          <Text color="red" bold>
            {warning}
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>确认执行？ </Text>
        <Text
          color={selected === 0 ? "green" : undefined}
          bold={selected === 0}
          inverse={selected === 0}
        >
          {" 是(Y) "}
        </Text>
        <Text> </Text>
        <Text
          color={selected === 1 ? "red" : undefined}
          bold={selected === 1}
          inverse={selected === 1}
        >
          {" 否(N) "}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>←→ 选择  Y/N 快捷键  ↵ 确认</Text>
      </Box>
    </Box>
  );
}

/**
 * 显示确认对话框并等待用户选择
 */
export function confirm(options: {
  title: string;
  message: string;
  items?: string[];
  warning?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ConfirmDialogComponent
        title={options.title}
        message={options.message}
        items={options.items}
        warning={options.warning}
        onConfirm={(confirmed) => {
          unmount();
          resolve(confirmed);
        }}
      />
    );
  });
}


