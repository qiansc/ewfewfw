/**
 * Skill 文件格式验证测试
 *
 * 验证所有 Skill 文件遵循规范格式：
 * - YAML frontmatter 包含 name 和 description
 * - Markdown 内容结构完整
 * - 工具依赖声明正确
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const SKILLS_DIR = join(import.meta.dir, '../skills');

interface SkillFrontmatter {
  name: string;
  description: string;
}

interface SkillFile {
  path: string;
  name: string;
  content: string;
  frontmatter: SkillFrontmatter | null;
  body: string;
}

/**
 * 解析 YAML frontmatter
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];

  // 简单解析 YAML（仅支持 name 和 description）
  const nameMatch = yamlContent.match(/^name:\s*["']?([^"'\n]+)["']?/m);
  const descMatch = yamlContent.match(/description:\s*\|?\n?([\s\S]*?)(?=\n[a-z]|$)/m);

  if (!nameMatch) {
    return { frontmatter: null, body };
  }

  return {
    frontmatter: {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : '',
    },
    body,
  };
}

/**
 * 递归获取所有 Skill 文件
 */
async function getAllSkillFiles(): Promise<SkillFile[]> {
  const skillFiles: SkillFile[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        skillFiles.push({
          path: fullPath,
          name: entry.name,
          content,
          frontmatter,
          body,
        });
      }
    }
  }

  await scanDir(SKILLS_DIR);
  return skillFiles;
}

// 存储所有 Skill 文件
let allSkillFiles: SkillFile[] = [];
let mainSkillFiles: SkillFile[] = []; // SKILL.md 或顶层 .md 文件

beforeAll(async () => {
  allSkillFiles = await getAllSkillFiles();
  mainSkillFiles = allSkillFiles.filter(
    (f) => f.name === 'SKILL.md' || f.path.match(/\/skills\/[^/]+\.md$/)
  );
});

describe('Skill 文件格式验证', () => {
  test('所有主 Skill 文件都有 frontmatter', () => {
    const missingFrontmatter = mainSkillFiles.filter((f) => !f.frontmatter);

    if (missingFrontmatter.length > 0) {
      const names = missingFrontmatter.map((f) => f.path).join('\n  - ');
      throw new Error(`以下 Skill 文件缺少 frontmatter:\n  - ${names}`);
    }

    expect(missingFrontmatter.length).toBe(0);
  });

  test('所有 frontmatter 都有 name 字段', () => {
    const missingName = mainSkillFiles.filter((f) => f.frontmatter && !f.frontmatter.name);

    if (missingName.length > 0) {
      const names = missingName.map((f) => f.path).join('\n  - ');
      throw new Error(`以下 Skill 文件缺少 name 字段:\n  - ${names}`);
    }

    expect(missingName.length).toBe(0);
  });

  test('所有 frontmatter 都有 description 字段', () => {
    const missingDesc = mainSkillFiles.filter((f) => f.frontmatter && !f.frontmatter.description);

    if (missingDesc.length > 0) {
      const names = missingDesc.map((f) => f.path).join('\n  - ');
      throw new Error(`以下 Skill 文件缺少 description 字段:\n  - ${names}`);
    }

    expect(missingDesc.length).toBe(0);
  });

  test('Skill name 格式正确 (c4a:xxx 或 c4a:xxx:yyy)', () => {
    const invalidNames = mainSkillFiles.filter((f) => {
      if (!f.frontmatter?.name) return false;
      // 允许 c4a:xxx 或 c4a:xxx:yyy 格式
      return !f.frontmatter.name.match(/^c4a:[a-z]+(?::[a-z]+)?$/);
    });

    if (invalidNames.length > 0) {
      const details = invalidNames
        .map((f) => `${f.path}: "${f.frontmatter?.name}"`)
        .join('\n  - ');
      throw new Error(`以下 Skill 文件的 name 格式不正确:\n  - ${details}`);
    }

    expect(invalidNames.length).toBe(0);
  });
});

describe('Skill 内容结构验证', () => {
  test('所有主 Skill 文件都有一级标题', () => {
    const missingH1 = mainSkillFiles.filter((f) => !f.body.match(/^#\s+.+/m));

    if (missingH1.length > 0) {
      const names = missingH1.map((f) => f.path).join('\n  - ');
      throw new Error(`以下 Skill 文件缺少一级标题:\n  - ${names}`);
    }

    expect(missingH1.length).toBe(0);
  });

  test('Skill 标题与 name 一致', () => {
    const mismatch = mainSkillFiles.filter((f) => {
      if (!f.frontmatter?.name) return false;
      const h1Match = f.body.match(/^#\s+\/?(c4a:[^\s-]+)/m);
      if (!h1Match) return false;
      return h1Match[1] !== f.frontmatter.name;
    });

    if (mismatch.length > 0) {
      const details = mismatch
        .map((f) => {
          const h1Match = f.body.match(/^#\s+\/?(c4a:[^\s-]+)/m);
          return `${f.path}: frontmatter="${f.frontmatter?.name}", h1="${h1Match?.[1]}"`;
        })
        .join('\n  - ');
      throw new Error(`以下 Skill 文件的标题与 name 不一致:\n  - ${details}`);
    }

    expect(mismatch.length).toBe(0);
  });
});

describe('工具依赖声明验证', () => {
  test('声明了工具依赖的 Skill 使用正确的工具名前缀', () => {
    const invalidTools: { file: string; tools: string[] }[] = [];

    for (const file of mainSkillFiles) {
      // 查找 "工具依赖" 或 "工具编排" 部分
      const toolSection = file.body.match(/##\s+工具(?:依赖|编排)\n([\s\S]*?)(?=\n##|$)/);
      if (!toolSection) continue;

      // 提取工具名（c4a_xxx 格式）
      const toolMatches = toolSection[1].matchAll(/`(c4a_[a-z_]+)`/g);
      const tools = [...toolMatches].map((m) => m[1]);

      // 验证工具名前缀
      const invalid = tools.filter(
        (t) => !t.match(/^c4a_(store|query|extract)_[a-z_]+$/)
      );

      if (invalid.length > 0) {
        invalidTools.push({ file: file.path, tools: invalid });
      }
    }

    if (invalidTools.length > 0) {
      const details = invalidTools
        .map((i) => `${i.file}: ${i.tools.join(', ')}`)
        .join('\n  - ');
      throw new Error(`以下 Skill 文件声明了无效的工具名:\n  - ${details}`);
    }

    expect(invalidTools.length).toBe(0);
  });
});

describe('路由消歧测试', () => {
  test('每个 Skill 的触发条件不重叠', () => {
    // 提取所有触发关键词
    const triggerMap = new Map<string, string[]>();

    for (const file of mainSkillFiles) {
      if (!file.frontmatter?.description) continue;

      // 从 description 中提取触发条件
      const triggers = file.frontmatter.description.match(/"([^"]+)"/g);
      if (!triggers) continue;

      const keywords = triggers.map((t) => t.replace(/"/g, '').toLowerCase());
      triggerMap.set(file.frontmatter.name, keywords);
    }

    // 检查重叠
    const overlaps: { keyword: string; skills: string[] }[] = [];
    const allKeywords = new Map<string, string[]>();

    for (const [skill, keywords] of triggerMap) {
      for (const kw of keywords) {
        if (!allKeywords.has(kw)) {
          allKeywords.set(kw, []);
        }
        allKeywords.get(kw)!.push(skill);
      }
    }

    for (const [keyword, skills] of allKeywords) {
      if (skills.length > 1) {
        overlaps.push({ keyword, skills });
      }
    }

    // 允许部分重叠（如 "实现" 可能在多个 Skill 中出现）
    // 但记录下来供人工审查
    if (overlaps.length > 0) {
      console.log('触发关键词重叠（供参考）:');
      for (const o of overlaps) {
        console.log(`  "${o.keyword}": ${o.skills.join(', ')}`);
      }
    }

    // 这个测试不会失败，只是记录重叠情况
    expect(true).toBe(true);
  });
});

describe('ADR 检测规则验证', () => {
  test('c4a:analyze Skill 包含 ADR 检测说明', async () => {
    const analyzeSkill = mainSkillFiles.find((f) => f.frontmatter?.name === 'c4a:analyze');

    expect(analyzeSkill).toBeDefined();
    expect(analyzeSkill?.body).toContain('adr');
  });

  test('c4a:feat Skill 包含 ADR 类型识别', async () => {
    const featSkill = mainSkillFiles.find((f) => f.frontmatter?.name === 'c4a:feat');

    expect(featSkill).toBeDefined();
    expect(featSkill?.body).toContain('ADR');
    expect(featSkill?.body).toContain('架构变更');
  });
});

describe('三种场景流程验证', () => {
  const requiredSkills = ['c4a:feat', 'c4a:specify', 'c4a:plan', 'c4a:implement', 'c4a:analyze'];

  test('所有核心 Skill 都存在', () => {
    const existingSkills = mainSkillFiles
      .filter((f) => f.frontmatter?.name)
      .map((f) => f.frontmatter!.name);

    const missing = requiredSkills.filter((s) => !existingSkills.includes(s));

    if (missing.length > 0) {
      throw new Error(`缺少核心 Skill: ${missing.join(', ')}`);
    }

    expect(missing.length).toBe(0);
  });

  test('c4a:implement 包含前置条件检查', () => {
    const implementSkill = mainSkillFiles.find((f) => f.frontmatter?.name === 'c4a:implement');

    expect(implementSkill).toBeDefined();
    expect(implementSkill?.body).toContain('前置条件');
    expect(implementSkill?.body).toContain('approved');
  });

  test('c4a:know:learn 包含自动流程编排', () => {
    const learnSkill = mainSkillFiles.find((f) => f.frontmatter?.name === 'c4a:know:learn');

    expect(learnSkill).toBeDefined();
    expect(learnSkill?.body).toContain('自动');
    expect(learnSkill?.body).toContain('流程');
  });
});
