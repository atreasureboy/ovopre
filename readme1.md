# ovopre 项目架构

ovopre 是一个从零开始构建的 CLI 编程助手框架，采用模块化、可扩展的架构设计。

## 🏗️ 整体架构概览

```
ovopre/
├── bin/                    # 可执行入口
├── src/                   # 源代码核心
│   ├── cli.js            # CLI 路由和参数解析
│   ├── commands/         # 所有命令实现
│   ├── core/             # 核心引擎
│   ├── tools/            # 工具系统
│   ├── services/         # 业务服务
│   ├── plugins/          # 插件系统
│   ├── skills/           # 技能系统
│   ├── mcp/              # MCP 集成
│   ├── observability/    # 可观测性
│   ├── outputStyles/     # 输出格式化
│   ├── ui/               # 用户界面
│   └── utils/            # 工具函数
├── .ovopre/              # 运行时配置
│   ├── config.json       # 主配置
│   ├── skills/           # 用户技能
│   ├── plugins/          # 用户插件
│   ├── mcp/              # MCP 配置
│   ├── logs/             # 日志和任务记录
│   ├── memories/         # 会话记忆
│   └── sessions/         # 会话数据
└── 外部依赖
    └── OpenAI 兼容 API
```

## 🔧 核心模块架构

### 1. CLI 入口层 (`bin/`, `src/cli.js`)
- **bin/ovopre.js**: Node.js 可执行入口
- **src/cli.js**: 命令路由和参数解析
- 支持 20+ 个子命令，统一处理逻辑

### 2. 命令系统 (`src/commands/`)
共 22 个命令模块，分类如下：

#### AI 交互命令
- `chat.js`: 交互式聊天实现
- `task.js`: 任务模式实现
- `model.js`: 模型管理

#### 配置管理
- `config.js`: 配置文件管理
- `skills.js`: 技能配置
- `plugins.js`: 插件管理
- `mcp.js`: MCP 服务器管理

#### 运维监控
- `stats.js`: 统计分析
- `cost.js`: 成本计算
- `report.js`: 报告生成
- `trace.js`: 任务跟踪
- `tasks.js`: 任务队列管理
- `logs.js`: 日志查看

#### 开发工具
- `files.js`: 文件浏览
- `diff.js`: 差异比较
- `export.js` / `import.js`: 数据导入导出
- `probe.js`: API 探测

#### 系统诊断
- `doctor.js`: 环境诊断
- `session.js`: 会话管理
- `status.js`: 系统状态
- `tools.js`: 工具列表
- `commands.js`: 命令帮助
- `version.js`: 版本信息

### 3. 核心引擎 (`src/core/`)
关键组件：

#### 任务执行引擎
- `taskRunner.js`: 任务状态机实现
  - 规划 (plan) → 执行 (execute) → 验证 (verify) → 总结 (summarize)
  - 支持多轮验证和智能重试
  - 失败自动回滚机制

#### 配置管理
- `config.js`: 配置加载和持久化
- `modelsRegistry.js`: 模型注册表

#### 会话和存储
- `sessionStore.js`: 会话数据存储
- `compaction.js`: 数据压缩

#### AI 集成
- `openaiClient.js`: OpenAI 兼容 API 客户端
- `agentLoop.js`: 代理循环实现

#### 任务调度
- `taskQueue.js`: 任务队列管理
- `hooks.js`: 钩子系统

### 4. 工具系统 (`src/tools/`)
- `definitions.js`: 工具 Schema 定义
- `executor.js`: 工具执行器
- `catalog.js`: 工具目录管理

支持的工具类别：
- 文件操作 (`read_file`, `write_file`, `replace_in_file`)
- Git 操作 (`git_diff`, `apply_patch`)
- 代码搜索 (`grep_files`, `code_index`)
- 系统命令 (`bash`)
- 项目管理 (`list_files`, `replace_in_files`)

### 5. 扩展系统

#### 插件系统 (`src/plugins/loader.js`)
- 支持 JavaScript 模块插件
- 热重载机制
- 沙盒执行环境

#### 技能系统 (`src/skills/loader.js`)
- Markdown 格式技能定义
- 编码风格和最佳实践
- 任务模板配置

#### MCP 集成 (`src/mcp/runtime.js`)
- Model Context Protocol 实现
- 多服务器会话管理
- 健康检查和重连机制

### 6. 服务层 (`src/services/`)
- `contextAnalysis.js`: 上下文分析
- `memoryExtractor.js`: 记忆提取

### 7. 可观测性 (`src/observability/`)
- `analytics.js`: 分析统计
- `taskTrace.js`: 任务跟踪

### 8. 用户界面 (`src/ui/`)
- `terminal.js`: 终端界面实现
- 实时状态显示
- 流式输出面板

### 9. 输出系统 (`src/outputStyles/`)
- 多格式输出支持
- 可配置样式

### 10. 工具函数 (`src/utils/`)
- `args.js`: 参数解析
- `stdin.js`: 标准输入处理

## 🔄 工作流程

### 交互模式流程
```
用户输入 → CLI 解析 → 会话管理 → 模型调用 → 工具执行 → 结果输出
```

### 任务模式流程
```
任务目标 → 规划阶段 → 执行阶段 → 验证阶段 → 总结阶段
        ↓          ↓           ↓           ↓
      生成计划 → 执行工具 → 多轮验证 → 最终报告
```

### 数据流架构
```
配置层 (.ovopre/)
  ├── 用户配置
  ├── 技能定义
  ├── 插件代码
  └── 日志数据
      ↓
核心层 (src/core/)
  ├── 配置加载
  ├── 会话管理
  ├── 任务执行
  └── AI 通信
      ↓
工具层 (src/tools/)
  ├── 工具定义
  ├── 执行逻辑
  └── 结果处理
      ↓
扩展层 (plugins/skills/mcp)
  ├── 自定义逻辑
  ├── 外部集成
  └── 协议通信
```

## 🛠️ 关键技术特性

### 1. 模块化设计
- 清晰的关注点分离
- 松耦合的组件
- 可插拔的扩展系统

### 2. 错误处理和恢复
- 多级重试机制
- 自动回滚系统
- 详细的错误日志

### 3. 性能优化
- 流式响应
- 内存高效的数据结构
- 异步并发处理

### 4. 可观测性
- 完整的任务跟踪
- 实时性能监控
- 成本分析和报告

### 5. 安全性
- 配置加密存储
- 沙盒插件执行
- 输入验证和清理

## 🔌 扩展点

### 自定义技能
在 `.ovopre/skills/` 目录创建 `.md` 文件：
```markdown
# 技能名称
编码规范、任务模板、最佳实践
```

### 开发插件
```javascript
// custom-plugin.mjs
export default {
  name: "my-plugin",
  init: (ctx) => ({ 
    tools: [], 
    hooks: {} 
  })
};
```

### MCP 集成
```bash
ovopre mcp add fs npx -y @modelcontextprotocol/server-filesystem /project
```

## 📊 数据存储架构

```
.ovopre/
├── config.json              # 主配置
├── skills/*.md             # 技能文件
├── plugins/*.mjs           # 插件文件
├── logs/
│   ├── tasks/*.jsonl       # 任务记录
│   ├── queue/*.log         # 队列日志
│   └── cost-report-*.json  # 成本报告
├── memories/*.md           # 记忆文件
├── sessions/*.json         # 会话数据
└── mcp/                    # MCP 配置
```

## 🔄 开发工作流

1. **配置阶段**: 加载配置、初始化插件
2. **执行阶段**: 解析命令、创建会话
3. **AI 交互**: 调用模型、处理工具调用
4. **结果处理**: 验证输出、更新状态
5. **清理阶段**: 保存会话、记录日志

## 🎯 设计原则

1. **单一职责**: 每个模块专注于一个功能
2. **开闭原则**: 支持扩展，避免修改核心
3. **依赖倒置**: 高层模块不依赖低层细节
4. **接口隔离**: 小且专注的接口
5. **迪米特法则**: 最小化模块间了解

## 🔮 架构演进方向

1. **插件生态**: 丰富的第三方插件
2. **云同步**: 配置和会话的云端备份
3. **团队协作**: 共享技能和配置
4. **性能优化**: 更快的响应时间
5. **协议支持**: 更多 AI 协议集成

---

**架构总结**: ovopre 采用分层架构设计，核心是任务执行引擎和工具系统，支持多种扩展方式，提供完整的可观测性和错误恢复机制，旨在成为稳定可靠的 AI 编程助手平台。