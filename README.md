# ovopre

`ovopre` 是一个从零开始搭建的纯 CLI 编程助手骨架，目标是逐步演进到类似 codex / claude code / iflow-cli 的体验。

当前版本（v0.1.0）先实现最小可用闭环：

- CLI 入口和命令分发
- `chat` 交互模式
- 单次提问模式
- 本地配置管理
- OpenAI 兼容 API（`/chat/completions`）调用
- 流式输出（SSE）
- 工具调用骨架（默认开启，可用 `--no-tools` 关闭）
- 专用任务模式 `task`（偏自动执行）
- 任务状态机（`plan -> execute -> verify -> summarize`，验证失败自动重试）
- 多轮验证与失败分类重试（test/lint/build/network/timeout）
- 任务失败可选自动回滚（仅回滚本次任务改动文件）
- 会话管理命令（`session list/show/rm`）
- 诊断命令（`doctor`）
- API 超时和重试机制（`timeoutMs`/`maxRetries`）
- 本地 skills / plugins / mcp 配置入口
- MCP 运行时会话复用 + 健康检查
- 任务轨迹日志（`.ovopre/logs/tasks/*.jsonl`）
- trace 命令查看任务轨迹
- stats 命令汇总任务成功率、tokens、阶段耗时
- model/tools/cost/report/commands 等运营命令

## 目录结构

```text
ovopre/
  bin/ovopre.js           # 可执行入口
  src/cli.js              # 主命令路由
  src/commands/
    chat.js               # 交互/单次聊天命令
    config.js             # 配置命令
    skills.js             # skills 管理
    plugins.js            # plugins 管理
    mcp.js                # mcp 配置管理
    session.js            # 会话管理命令
    doctor.js             # 环境诊断命令
  src/core/
    config.js             # 配置加载与持久化
    taskRunner.js         # task 状态机
    openaiClient.js       # OpenAI-compatible API 客户端
    sessionStore.js       # 会话历史存储
  src/tools/
    definitions.js        # 工具 schema
    executor.js           # 工具执行器（含 apply_patch）
  src/utils/
    args.js               # 参数解析
```

## 快速开始

```bash
cd /project/ovopre
node bin/ovopre.js --help
bash install.sh
ovopre
```

### 配置 API

方式 1：环境变量（推荐在 CI / 临时环境）

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4.1-mini"
export OPENAI_TEMPERATURE="0.2"
export OPENAI_TIMEOUT_MS="120000"
export OPENAI_MAX_RETRIES="2"
export OVOPRE_PRICE_INPUT_PER_1M="0.00"
export OVOPRE_PRICE_OUTPUT_PER_1M="0.00"
```

也兼容这些同义变量（便于复用其他 CLI 的环境）：

```bash
export OVOGO_MODEL="deepseek-reasoner"
export OVOPRE_MODEL="deepseek-reasoner"
export OPENAI_API_BASE="https://api.deepseek.com"
```

可选配置目录（默认是当前项目下 `.ovopre/`）：

```bash
export OVOPRE_HOME="$HOME/.ovopre"
```

DeepSeek 兼容示例：

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_BASE_URL="https://api.deepseek.com"
export OPENAI_MODEL="deepseek-chat"
export DEEPSEEK_MODEL_TEMPERATURE="1"
```

方式 2：本地配置文件（默认在当前项目 `.ovopre/config.json`）

```bash
node bin/ovopre.js config init --api-key your_api_key --base-url https://api.openai.com/v1 --model gpt-4.1-mini
```

## 使用

单次提问：

```bash
node bin/ovopre.js "帮我生成一个 TypeScript CLI 工具目录结构"
```

关闭流式：

```bash
node bin/ovopre.js "解释这个项目结构" --no-stream
```

交互模式：

```bash
node bin/ovopre.js chat --session coding
ovopre
```

默认直接运行 `ovopre` 会进入交互终端界面（带 banner / 状态行）。
交互界面包含实时状态条（phase/model/tokens/tools/cost/round）和工具调用流式面板。

模型与工具：

```bash
node bin/ovopre.js model show
node bin/ovopre.js model set deepseek-chat
node bin/ovopre.js tools
node bin/ovopre.js probe
node bin/ovopre.js probe deepseek-reasoner --fast
node bin/ovopre.js models
node bin/ovopre.js models refresh
node bin/ovopre.js models use deepseek-reasoner
```

任务模式（自动完成目标）：

```bash
node bin/ovopre.js task "为当前仓库补齐 README 并运行测试"
node bin/ovopre.js task "修复测试并补齐文档" --max-task-retries 3
node bin/ovopre.js task "修复 lint" --verify-rounds 3
node bin/ovopre.js task "修复失败任务" --auto-rollback-on-fail
```

skills / plugins / mcp：

```bash
node bin/ovopre.js skills init-sample
node bin/ovopre.js skills list
node bin/ovopre.js plugins init-sample
node bin/ovopre.js plugins list
node bin/ovopre.js plugins install /path/to/plugin.mjs
node bin/ovopre.js plugins update my-plugin.mjs /path/to/plugin.mjs
node bin/ovopre.js plugins rm my-plugin.mjs
node bin/ovopre.js plugins reload
node bin/ovopre.js mcp add local-mcp npx -y @modelcontextprotocol/server-filesystem /project
node bin/ovopre.js mcp list
node bin/ovopre.js mcp tools
node bin/ovopre.js mcp health
node bin/ovopre.js mcp runtime
node bin/ovopre.js mcp reset
```

会话管理：

```bash
node bin/ovopre.js session list
node bin/ovopre.js session show default
node bin/ovopre.js session rm default
```

任务轨迹：

```bash
node bin/ovopre.js trace list
node bin/ovopre.js trace show latest
```

统计：

```bash
node bin/ovopre.js stats
node bin/ovopre.js stats 7
node bin/ovopre.js stats trend 30
node bin/ovopre.js stats model 30
node bin/ovopre.js stats task-type 30
node bin/ovopre.js stats failure 30
node bin/ovopre.js stats export 30 csv /tmp/ovopre_cost.csv
node bin/ovopre.js cost 30
node bin/ovopre.js report 7
node bin/ovopre.js tasks run "修复 lint 并补齐 README"
node bin/ovopre.js tasks list
node bin/ovopre.js tasks show t_20260101_abcd12
node bin/ovopre.js tasks cancel t_20260101_abcd12
```

交互模式支持常用斜杠命令：

```text
/plan /status /usage /session /plugins /skills /mcp /models /task /tasks /clear /exit
```

诊断：

```bash
node bin/ovopre.js doctor
```

## 后续增强

- MCP 工具与资源运行时稳定性增强（重连/长连接复用/更多兼容性）
- 插件 sandbox 与版本管理
- 更完整的测试与评估基线
