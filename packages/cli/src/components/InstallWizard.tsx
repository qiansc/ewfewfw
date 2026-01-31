import React from "react";
import { Box, Text } from "ink";

export type InstallStepStatus = "idle" | "running" | "success" | "error";

export interface InstallWizardStep {
  label: string;
  status: InstallStepStatus;
  message?: string;
}

export interface InstallWizardProps {
  title?: string;
  mode?: "local" | "server" | "remote" | "skip";
  steps?: InstallWizardStep[];
  error?: string;
  retryHint?: string;
}

const STATUS_LABEL: Record<InstallStepStatus, string> = {
  idle: "等待开始",
  running: "进行中",
  success: "已完成",
  error: "失败",
};

const STATUS_COLOR: Record<InstallStepStatus, string> = {
  idle: "gray",
  running: "yellow",
  success: "green",
  error: "red",
};

export const InstallWizard: React.FC<InstallWizardProps> = ({
  title = "安装向导",
  mode,
  steps = [],
  error,
  retryHint,
}) => {
  return (
    <Box flexDirection="column">
      <Text>{title}</Text>
      {mode ? <Text color="gray">模式: {mode}</Text> : null}
      {steps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {steps.map((step, index) => (
            <Box key={`${step.label}-${index}`} flexDirection="column">
              <Text color={STATUS_COLOR[step.status]}>
                {STATUS_LABEL[step.status]} - {step.label}
              </Text>
              {step.message ? <Text color="gray">  {step.message}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}
      {error ? (
        <Box marginTop={1}>
          <Text color="red">错误: {error}</Text>
        </Box>
      ) : null}
      {retryHint ? (
        <Box>
          <Text color="yellow">{retryHint}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
