/**
 * 安全工具单元测试
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { INPUT_ERROR_CODES } from '../../types/errors.js';
import {
  escapeHtml,
  escapeMermaidString,
  safeReadFile,
  validatePath,
} from '../security.js';

const TMP_BASE = join(process.cwd(), '.tmp');

let projectRoot = '';
let outsideRoot = '';

beforeAll(async () => {
  await mkdir(TMP_BASE, { recursive: true });
  projectRoot = await mkdtemp(join(TMP_BASE, 'security-project-'));
  outsideRoot = await mkdtemp(join(TMP_BASE, 'security-outside-'));
});

afterAll(async () => {
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
  }
  if (outsideRoot) {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

describe('escapeHtml', () => {
  test('转义 HTML 特殊字符', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#039;');
  });

  test('空字符串返回空字符串', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('无特殊字符原样返回', () => {
    expect(escapeHtml('hello-world')).toBe('hello-world');
  });
});

describe('escapeMermaidString', () => {
  test('转义 Mermaid 特殊字符', () => {
    expect(escapeMermaidString('A"#;B')).toBe('A#quot;#35;#59;B');
  });

  test('转义换行符', () => {
    expect(escapeMermaidString('line1\nline2')).toBe('line1#10;line2');
  });
});

describe('validatePath', () => {
  test('允许简单相对路径', async () => {
    const result = await validatePath('foo/bar.txt', projectRoot);
    expect(result.valid).toBe(true);
  });

  test('允许 ./ 前缀路径', async () => {
    const result = await validatePath('./foo/bar.txt', projectRoot);
    expect(result.valid).toBe(true);
  });

  test('标准化 Windows 路径分隔符', async () => {
    const result = await validatePath('foo\\bar.txt', projectRoot);
    expect(result.valid).toBe(true);
  });

  test('拒绝父目录引用', async () => {
    const result = await validatePath('../secret.txt', projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.INVALID_PATH_CHARS);
  });

  test('拒绝隐藏的父目录引用', async () => {
    const result = await validatePath('foo/../../secret.txt', projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.INVALID_PATH_CHARS);
  });

  test('拒绝绝对路径（Unix）', async () => {
    const result = await validatePath('/etc/passwd', projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.INVALID_PATH_CHARS);
  });

  test('拒绝绝对路径（Windows）', async () => {
    const result = await validatePath('C:\\Windows', projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.INVALID_PATH_CHARS);
  });

  test('拒绝空路径', async () => {
    const result = await validatePath('', projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.INVALID_PATH_CHARS);
  });

  test('拒绝逃逸的符号链接', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const outsideFile = join(outsideRoot, `secret-${Date.now()}.txt`);
    await writeFile(outsideFile, 'secret', 'utf-8');

    const linkPath = join(projectRoot, `escape-link-${Date.now()}`);
    await symlink(outsideFile, linkPath);

    const result = await validatePath(relative(projectRoot, linkPath), projectRoot);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(INPUT_ERROR_CODES.PATH_TRAVERSAL);
  });
});

describe('safeReadFile', () => {
  test('正常读取项目内文件', async () => {
    const filePath = join(projectRoot, `inside-${Date.now()}.txt`);
    await writeFile(filePath, 'hello', 'utf-8');

    const data = await safeReadFile(relative(projectRoot, filePath), projectRoot);
    expect(data.toString()).toBe('hello');
  });

  test('拒绝读取项目外文件', async () => {
    await expect(safeReadFile('../outside.txt', projectRoot)).rejects.toMatchObject({
      code: INPUT_ERROR_CODES.INVALID_PATH_CHARS,
    });
  });

  test('拒绝通过符号链接读取项目外文件', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const outsideFile = join(outsideRoot, `secret-${Date.now()}.txt`);
    await writeFile(outsideFile, 'secret', 'utf-8');

    const linkPath = join(projectRoot, `escape-link-${Date.now()}`);
    await symlink(outsideFile, linkPath);

    await expect(safeReadFile(relative(projectRoot, linkPath), projectRoot)).rejects.toMatchObject({
      code: INPUT_ERROR_CODES.PATH_TRAVERSAL,
    });
  });

  test('文件不存在时抛出错误', async () => {
    await expect(safeReadFile('missing.txt', projectRoot)).rejects.toBeTruthy();
  });
});
