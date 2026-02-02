/**
 * build 命令实现
 */
import { spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

type ConfirmOptions = {
  title: string;
  message: string;
  items?: string[];
  warning?: string;
  confirmText?: string;
  cancelText?: string;
};

type BuildContext = {
  projectRoot: string;
  checkDependencies: (required: string[], optional?: string[]) => Promise<boolean>;
  runForeground: (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ) => Promise<void>;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  blue: (msg: string) => string;
  green: (msg: string) => string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  waitForInput: (prompt: string) => Promise<string>;
};

type DistPackage = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
};

export async function cmdBuild(args: string[] = [], ctx: BuildContext): Promise<void> {
  const publish = args.includes("--publish");

  console.log("\n" + ctx.blue("═".repeat(50)));
  console.log(ctx.blue(publish ? "  C4A v2 - 编译并发布用户 CLI" : "  C4A v2 - 编译用户 CLI"));
  console.log(ctx.blue("═".repeat(50)) + "\n");

  if (!(await ctx.checkDependencies(["bun"]))) {
    process.exit(1);
  }

  const cliDir = resolve(ctx.projectRoot, "packages/cli");
  const distDir = resolve(cliDir, "dist");
  const distIndex = resolve(distDir, "index.js");
  const yogaWasmDest = resolve(distDir, "yoga.wasm");
  const skillsSrc = resolve(ctx.projectRoot, "prompts/skills");
  const skillsDest = resolve(distDir, "skills");
  const schemasSrc = resolve(ctx.projectRoot, "packages/core/src/schemas");
  const schemasDest = resolve(distDir, "schemas");

  await rm(distDir, { recursive: true, force: true });

  ctx.info("编译 TypeScript...");
  await ctx.runForeground("bun", ["run", "build"], { cwd: cliDir });

  await mkdir(distDir, { recursive: true });

  if (!(await isFile(distIndex))) {
    ctx.error("编译失败：未找到 packages/cli/dist/index.js");
    process.exit(1);
  }
  await ensureBunShebang(distIndex);
  ctx.success("TypeScript 编译完成");

  ctx.info("打包 Skills...");
  await copyDir(skillsSrc, skillsDest);
  ctx.success("Skills 已打包");

  ctx.info("复制 JSON Schema...");
  await copyDir(schemasSrc, schemasDest);
  ctx.success("Schema 已复制");

  ctx.info("生成 dist/package.json...");
  const { distPkgPath, distPkg } = await generateDistPackageJson(cliDir, distDir);
  ctx.success("dist/package.json 已生成");

  const yogaWasmSource = await resolveYogaWasmPath(ctx.projectRoot);
  if (yogaWasmSource) {
    await copyFile(yogaWasmSource, yogaWasmDest);
  } else {
    ctx.warn("未找到 yoga.wasm，CLI 运行时可能报错");
  }

  ctx.info("设置可执行权限...");
  await chmod(distIndex, 0o755);
  ctx.success("可执行权限已设置");

  const { files, bytes } = await getDirectoryStats(distDir);

  console.log("\n" + ctx.green("═".repeat(50)));
  console.log(ctx.green("  ✅ 编译完成"));
  console.log(ctx.green("═".repeat(50)));
  console.log(`\n  输出目录: ${distDir}`);
  console.log(`  大小: ${formatBytes(bytes)}`);
  console.log(`  文件数: ${files}`);

  if (!publish) {
    console.log("\n  测试:");
    console.log("    cd packages/cli/dist && bunx npm link");
    console.log("    c4a --version\n");
    return;
  }

  await publishToNpm(ctx, distDir, distPkgPath, distPkg);
}

async function publishToNpm(
  ctx: BuildContext,
  distDir: string,
  distPkgPath: string,
  distPkg: DistPackage
): Promise<void> {
  const issues = validateDistPackage(distPkg);
  if (issues.length > 0) {
    ctx.error("dist/package.json 存在问题，无法发布:");
    for (const issue of issues) {
      ctx.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const defaultVersion = distPkg.version ?? "0.0.0";
  const versionInput = (await ctx.waitForInput(`版本号 [${defaultVersion}]: `)).trim();
  const targetVersion = versionInput || defaultVersion;

  if (targetVersion !== defaultVersion) {
    distPkg.version = targetVersion;
    await writeFile(distPkgPath, `${JSON.stringify(distPkg, null, 2)}\n`);
    ctx.success(`已更新 dist/package.json 版本号为 ${targetVersion}`);
  }

  const confirmed = await ctx.confirm({
    title: "build --publish - 发布 npm 包",
    message: `将发布 ${distPkg.name ?? "package"}@${targetVersion}`,
    items: [`目录: ${distDir}`],
    warning: "请确保已登录 npm（npm login）",
    confirmText: "发布",
    cancelText: "取消",
  });

  if (!confirmed) {
    ctx.warn("已取消发布");
    return;
  }

  ctx.info("发布到 npm...");
  const exitCode = await runForegroundWithStatus("bunx", ["npm", "publish", distDir], {
    cwd: ctx.projectRoot,
  });

  if (exitCode === 0) {
    ctx.success("发布成功");
    console.log(`\n  ${distPkg.name ?? "package"}@${targetVersion}`);
  } else {
    ctx.error(`发布失败 (exit code: ${exitCode})`);
    process.exit(1);
  }
}

async function runForegroundWithStatus(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
    });
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

function validateDistPackage(distPkg: DistPackage): string[] {
  const issues: string[] = [];
  const dependencies = distPkg.dependencies ?? {};

  if (dependencies["@c4a/core"]) {
    issues.push("包含 @c4a/core 依赖");
  }
  if (dependencies["@c4a/storage"]) {
    issues.push("包含 @c4a/storage 依赖");
  }

  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version === "string" && version.startsWith("workspace:")) {
      issues.push(`依赖 ${name} 使用 workspace:*`);
    }
  }

  return issues;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function generateDistPackageJson(
  cliDir: string,
  distDir: string
): Promise<{ distPkgPath: string; distPkg: DistPackage }> {
  const srcPkgPath = resolve(cliDir, "package.json");
  const distPkgPath = resolve(distDir, "package.json");

  const srcPkg = JSON.parse(await readFile(srcPkgPath, "utf-8")) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, unknown>;
  };
  const bundledDeps = new Set(["@c4a/core", "@c4a/storage"]);
  const dependencyEntries = Object.entries(srcPkg.dependencies ?? {}).filter(
    (entry): entry is [string, string] => {
      const [name, version] = entry;
      if (bundledDeps.has(name)) {
        return false;
      }
      return typeof version === "string" && !version.startsWith("workspace:");
    }
  );
  const dependencies = Object.fromEntries(dependencyEntries);

  const distPkg: DistPackage = {
    name: srcPkg.name,
    version: srcPkg.version,
    dependencies,
  };

  const output = {
    name: distPkg.name,
    version: distPkg.version,
    type: "module",
    bin: { c4a: "./index.js" },
    dependencies,
  };

  await mkdir(distDir, { recursive: true });
  await writeFile(distPkgPath, `${JSON.stringify(output, null, 2)}\n`);

  return { distPkgPath, distPkg: output };
}

async function getDirectoryStats(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const childStats = await getDirectoryStats(fullPath);
      files += childStats.files;
      bytes += childStats.bytes;
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      files += 1;
      bytes += info.size;
    }
  }

  return { files, bytes };
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

async function ensureBunShebang(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  if (content.startsWith("#!")) {
    const lines = content.split("\n");
    lines[0] = "#!/usr/bin/env bun";
    await writeFile(filePath, lines.join("\n"));
    return;
  }
  await writeFile(filePath, `#!/usr/bin/env bun\n${content}`);
}

async function resolveYogaWasmPath(projectRoot: string): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("yoga-wasm-web/dist/yoga.wasm");
  } catch {
    // ignore
  }
  try {
    const bunDir = resolve(projectRoot, "node_modules/.bun");
    const entries = await readdir(bunDir, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("yoga-wasm-web@"));
    if (!match) {
      return null;
    }
    const candidate = resolve(bunDir, match.name, "node_modules/yoga-wasm-web/dist/yoga.wasm");
    await stat(candidate);
    return candidate;
  } catch {
    return null;
  }
}
