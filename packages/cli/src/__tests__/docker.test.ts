import { describe, expect, test } from "bun:test";
import {
  getContainerStatus,
  startContainers,
  getContainerLogs,
  type CommandRunner,
} from "../utils/docker.js";

describe("docker utils", () => {
  test("getContainerStatus fills missing containers", async () => {
    const runner: CommandRunner = async () => ({
      stdout: "c4a-mongodb\tUp 2 minutes (healthy)\t0.0.0.0:27017->27017/tcp\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await getContainerStatus(["c4a-mongodb", "c4a-neo4j"], runner);
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe("running");
    expect(result[0].health).toBe("healthy");
    expect(result[1].state).toBe("not_found");
  });

  test("startContainers passes container names", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await startContainers(["c4a-mongodb"], runner);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ command: "docker", args: ["start", "c4a-mongodb"] });
  });

  test("getContainerLogs builds logs command", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "logs", stderr: "", exitCode: 0 };
    };

    await getContainerLogs("c4a-mongodb", { tail: 10, timestamps: true }, runner);
    expect(calls[0]).toEqual({
      command: "docker",
      args: ["logs", "--timestamps", "--tail", "10", "c4a-mongodb"],
    });
  });
});
