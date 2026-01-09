// C4A 知识库数据
const C4A_DATA = {
  "c4a-cli": {
    title: "c4a-cli",
    subtitle: "交互式命令行工具",
    description: "提供本地 TUI 交互界面，支持架构知识浏览、创建和管理。",
    tags: ["cli", "tui", "interactive"],
    tagColor: "blue",
    tech: [
      ["语言", "TypeScript"],
      ["框架", "Ink (React for CLI)"],
      ["运行时", "Bun"]
    ],
    sections: [
      {
        title: "依赖",
        type: "list",
        items: [
          "c4a-dsl-mcp - DSL 解析验证",
          "c4a-code-mcp - 代码分析",
          "c4a-data-mcp - 数据服务"
        ]
      }
    ]
  },
  "c4a-core": {
    title: "c4a-core",
    subtitle: "共享核心库",
    description: "提供 DSL Schema、类型定义、验证逻辑等共享功能，被所有 TypeScript 模块依赖。",
    tags: ["core", "schema", "types"],
    tagColor: "purple",
    tech: [
      ["语言", "TypeScript"],
      ["验证", "Zod + JSON Schema"],
      ["运行时", "Bun / Node.js"]
    ],
    sections: [
      {
        title: "提供能力",
        type: "list",
        items: [
          "C4A DSL Schema 定义",
          "TypeScript 类型导出",
          "验证工具函数",
          "通用工具库"
        ]
      }
    ]
  },
  "c4a-dsl-mcp": {
    title: "c4a-dsl-mcp",
    subtitle: "DSL 解析验证 MCP Server",
    description: "提供 C4A DSL 的解析、验证、生成和本地文件管理能力。",
    tags: ["mcp", "dsl", "parser"],
    tagColor: "green",
    tech: [
      ["语言", "TypeScript"],
      ["协议", "MCP (stdio)"],
      ["端口", "8051 (HTTP 模式)"]
    ],
    sections: [
      {
        title: "MCP Tools",
        type: "list",
        items: [
          "c4a_dsl_parse - 解析 DSL 文件",
          "c4a_dsl_validate - 验证 DSL 正确性",
          "c4a_dsl_generate - 生成 DSL 模板",
          "c4a_dsl_schema - 获取 JSON Schema",
          "c4a_local_* - 本地文件操作"
        ]
      }
    ]
  },
  "c4a-code-mcp": {
    title: "c4a-code-mcp",
    subtitle: "代码分析 MCP Server",
    description: "基于 Tree-sitter 的代码分析工具，提取接口、类型、依赖关系，生成 API 契约。",
    tags: ["mcp", "code-analysis", "tree-sitter"],
    tagColor: "green",
    tech: [
      ["语言", "TypeScript"],
      ["解析器", "Tree-sitter"],
      ["端口", "8052 (HTTP 模式)"]
    ],
    sections: [
      {
        title: "MCP Tools",
        type: "list",
        items: [
          "c4a_code_extract - 提取接口/类型定义",
          "c4a_code_analyze - 分析代码结构和依赖",
          "c4a_code_ast - 获取 AST 结构",
          "c4a_code_contract - 生成 API 契约"
        ]
      },
      {
        title: "支持语言",
        type: "tags",
        items: ["TypeScript", "Go", "Python"]
      }
    ]
  },
  "c4a-data-mcp": {
    title: "c4a-data-mcp",
    subtitle: "统一数据服务 MCP Server",
    description: "管理架构知识的持久化存储，提供文档存储、图查询、语义搜索三位一体的数据服务。",
    tags: ["mcp", "data", "storage"],
    tagColor: "green",
    tech: [
      ["语言", "Python"],
      ["框架", "FastAPI + MCP"],
      ["端口", "8050"]
    ],
    sections: [
      {
        title: "MCP Tools",
        type: "list",
        items: [
          "c4a_db_save_entity - 保存实体到三库",
          "c4a_db_get_entity - 查询实体",
          "c4a_db_search_semantic - 语义搜索",
          "c4a_db_query_deps - 查询依赖关系",
          "c4a_db_query_impact - 影响分析",
          "c4a_db_exec_cypher - 执行 Cypher 查询"
        ]
      },
      {
        title: "存储后端",
        type: "tags",
        items: ["MongoDB", "Neo4j", "Milvus"],
        tagColor: "orange"
      }
    ]
  },
  "config-generator": {
    title: "config-generator",
    subtitle: "配置生成器",
    description: "根据架构知识自动生成 Agent 配置文件，支持多种 Agent 基座。",
    tags: ["generator", "config", "multi-agent"],
    tagColor: "purple",
    tech: [
      ["语言", "TypeScript"],
      ["验证", "Zod"],
      ["模板", "内置模板引擎"]
    ],
    sections: [
      {
        title: "支持的 Agent 基座",
        type: "list",
        items: [
          "Claude SDK - Anthropic 官方 SDK",
          "OpenCode - 开源 Agent 框架",
          "更多基座扩展中..."
        ]
      },
      {
        title: "相关 ADR",
        type: "link",
        text: "ADR-002: 多基座兼容设计",
        target: "adr-002"
      }
    ]
  },
  "adr-001": {
    title: "ADR-001: v2 架构重构",
    status: "已发布",
    date: "2026-01-07",
    summary: "将 C4A 从单体架构重构为基于 MCP 的微服务架构，实现更好的模块化和扩展性。",
    context: [
      "原有单体架构难以扩展",
      "需要支持多种 Agent 基座",
      "数据存储需求多样化（文档、图、向量）"
    ],
    decision: [
      "采用 MCP 协议作为服务间通信标准",
      "拆分为 DSL、Code、Data 三个 MCP Server",
      "引入 MongoDB + Neo4j + Milvus 三库架构",
      "使用配置生成器支持多基座"
    ],
    impact: ["c4a-dsl-mcp", "c4a-code-mcp", "c4a-data-mcp", "config-generator"]
  },
  "adr-002": {
    title: "ADR-002: 多基座兼容设计",
    status: "已发布",
    date: "2026-01-08",
    summary: "设计统一的配置生成器，支持多种 Agent 基座（Claude SDK、OpenCode 等），避免为每个基座重复开发。",
    context: [
      "市场上存在多种 Agent 框架",
      "不同框架的配置格式差异大",
      "需要统一的知识描述和配置生成"
    ],
    decision: [
      "设计统一的配置生成器接口",
      "使用适配器模式支持不同基座",
      "配置生成与知识存储解耦",
      "支持自定义 Prompt 模板"
    ],
    impact: ["config-generator", "c4a-core"]
  },
  "externals": {
    title: "外部依赖",
    items: [
      {
        name: "MongoDB",
        description: "文档数据库，存储架构知识的主数据。",
        tech: [
          ["版本", "7.0"],
          ["端口", "27017"],
          ["用途", "System/Container/Component/ADR 文档存储"]
        ]
      },
      {
        name: "Neo4j",
        description: "图数据库，存储实体间的依赖关系。",
        tech: [
          ["版本", "5.x"],
          ["端口", "7474 (Browser) / 7687 (Bolt)"],
          ["用途", "依赖图谱、影响分析、Cypher 查询"]
        ]
      },
      {
        name: "Milvus",
        description: "向量数据库，支持语义搜索。",
        tech: [
          ["版本", "2.4"],
          ["端口", "19530"],
          ["用途", "架构知识的向量索引和语义检索"]
        ]
      }
    ],
    collaboration: {
      title: "三库协同",
      description: "c4a-data-mcp 统一管理三个存储后端，实现：",
      items: [
        "写入时自动同步到三库",
        "按需选择查询方式（文档/图/向量）",
        "删除时级联清理"
      ]
    }
  }
};

// 渲染函数
function renderContainerPage(id, data) {
  const tagColorClass = `tag-${data.tagColor || 'blue'}`;
  let html = `
    <h2 class="text-xl font-bold mb-4">${data.title}</h2>
    <div class="card">
      <h3 class="text-lg font-semibold mb-2">${data.subtitle}</h3>
      <p class="text-gray-600 mb-4">${data.description}</p>
      <div class="mb-4">
        ${data.tags.map(t => `<span class="tag ${tagColorClass}">${t}</span>`).join('')}
      </div>
    </div>
    <div class="card">
      <h4 class="font-medium mb-3">技术栈</h4>
      <table>
        ${data.tech.map(([k, v]) => `<tr><td class="font-medium w-32">${k}</td><td>${v}</td></tr>`).join('')}
      </table>
    </div>
  `;

  if (data.sections) {
    data.sections.forEach(sec => {
      html += '<div class="card">';
      html += `<h4 class="font-medium mb-3">${sec.title}</h4>`;
      if (sec.type === 'list') {
        html += `<ul class="list-disc list-inside text-gray-600">${sec.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
      } else if (sec.type === 'tags') {
        const tc = sec.tagColor ? `tag-${sec.tagColor}` : 'tag-gray';
        html += `<div>${sec.items.map(i => `<span class="tag ${tc}">${i}</span>`).join('')}</div>`;
      } else if (sec.type === 'link') {
        html += `<div class="cursor-pointer text-blue-600 hover:underline" onclick="showTab('${sec.target}')">${sec.text}</div>`;
      }
      html += '</div>';
    });
  }

  document.getElementById(id).innerHTML = html;
}

function renderAdrPage(id, data) {
  const html = `
    <h2 class="text-xl font-bold mb-4">${data.title}</h2>
    <div class="card">
      <div class="flex gap-2 mb-3">
        <span class="tag tag-green">${data.status}</span>
        <span class="tag tag-gray">${data.date}</span>
      </div>
      <h3 class="text-lg font-semibold mb-2">概述</h3>
      <p class="text-gray-600 mb-4">${data.summary}</p>
    </div>
    <div class="card">
      <h4 class="font-medium mb-3">决策背景</h4>
      <ul class="list-disc list-inside text-gray-600">
        ${data.context.map(i => `<li>${i}</li>`).join('')}
      </ul>
    </div>
    <div class="card">
      <h4 class="font-medium mb-3">决策内容</h4>
      <ul class="list-disc list-inside text-gray-600">
        ${data.decision.map(i => `<li>${i}</li>`).join('')}
      </ul>
    </div>
    <div class="card">
      <h4 class="font-medium mb-3">影响范围</h4>
      <div>
        ${data.impact.map(i => `<span class="tag tag-blue">${i}</span>`).join('')}
      </div>
    </div>
  `;
  document.getElementById(id).innerHTML = html;
}

function renderExternalsPage(data) {
  let html = `<h2 class="text-xl font-bold mb-4">${data.title}</h2>`;

  data.items.forEach(item => {
    html += `
      <div class="card">
        <h3 class="text-lg font-semibold mb-2">${item.name}</h3>
        <p class="text-gray-600 mb-3">${item.description}</p>
        <table>
          ${item.tech.map(([k, v]) => `<tr><td class="font-medium w-32">${k}</td><td>${v}</td></tr>`).join('')}
        </table>
      </div>
    `;
  });

  html += `
    <div class="card">
      <h4 class="font-medium mb-3">${data.collaboration.title}</h4>
      <p class="text-gray-600">${data.collaboration.description}</p>
      <ul class="list-disc list-inside text-gray-600 mt-2">
        ${data.collaboration.items.map(i => `<li>${i}</li>`).join('')}
      </ul>
    </div>
  `;

  document.getElementById('externals').innerHTML = html;
}

// 初始化页面内容
document.addEventListener('DOMContentLoaded', function() {
  // 渲染容器页面
  ['c4a-cli', 'c4a-core', 'c4a-dsl-mcp', 'c4a-code-mcp', 'c4a-data-mcp', 'config-generator'].forEach(id => {
    if (C4A_DATA[id]) renderContainerPage(id, C4A_DATA[id]);
  });

  // 渲染 ADR 页面
  ['adr-001', 'adr-002'].forEach(id => {
    if (C4A_DATA[id]) renderAdrPage(id, C4A_DATA[id]);
  });

  // 渲染外部依赖页面
  if (C4A_DATA.externals) renderExternalsPage(C4A_DATA.externals);
});
