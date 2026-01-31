import { describe, expect, test } from "bun:test";
import { renderChecklistMarkdown } from "../core/checklistRender.js";

describe("renderChecklistMarkdown", () => {
  test("renders checklist markdown with footer", () => {
    const markdown = renderChecklistMarkdown({
      version: "1.0",
      metadata: { feat_id: "feat-demo" },
      items: [
        { id: "task-1", title: "完成任务", status: "completed" },
        { id: "task-2", title: "继续任务", status: "pending", assignee: "alice" },
      ],
    });

    expect(markdown).toContain("# Checklist: feat-demo");
    expect(markdown).toContain("- [x] 完成任务 (task-1)");
    expect(markdown).toContain("负责人: alice");
    expect(markdown).toContain("此文件由 `c4a feat render` 自动生成");
  });
});
