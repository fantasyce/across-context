# Across Context

![Quality](https://github.com/fantasyce/across-context/actions/workflows/quality.yml/badge.svg)
![Security](https://github.com/fantasyce/across-context/actions/workflows/security.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

One local-first memory layer for every coding agent.

![Across Context hero](assets/readme/across-context-hero.png)

Across Context is a zero-runtime-dependency CLI and MCP server that gives Codex,
Claude Code, Cursor, Hermes, OpenClaw, and future coding agents one shared local
source of truth. It stores durable preferences, project decisions, reusable
commands, and compact session summaries in a local vault, then teaches agents
when to read and write that memory.

## English

### Why It Exists

Modern coding agents are powerful, but their memory is fragmented. A useful
preference learned by one agent often stays trapped in one chat, one IDE, or one
tool-specific history. Across Context makes that memory portable across agents
without sending it to a hosted service.

Use it when you want agents to remember:

- how you like work to be done
- how a repository is built, tested, and released
- which project decisions were already made
- which commands are safe and repeatable
- what the last agent learned during a complex task

### What It Does

- Creates a local vault at `~/.across/data/across-context`
- Runs a stdio MCP server with memory tools
- Detects supported local agents
- Registers MCP integrations where each agent supports it
- Generates `AGENTS.md`, `CLAUDE.md`, and Cursor rules
- Adds behavior rules so agents know when to read and write memory
- Protects the vault with a memory policy engine
- Provides a local dashboard, explainable hybrid search, pending approval, lifecycle controls, MCP resources and prompts, team export, and deterministic hooks

### How It Works

![Across Context architecture](assets/readme/across-context-architecture.svg)

Across Context has three layers:

1. **MCP tools, resources, and prompts** give agents the ability to search, write, inspect, and reuse memory workflows.
2. **Generated rules** teach agents when to use those capabilities.
3. **Memory policy** rejects unsafe or low-value writes before they reach disk.

This is the important product idea: MCP alone is not enough. Agents also need
operating instructions, and automatic memory needs guardrails.

### Next release

- Adds an Across Autopilot memory policy surface so autonomous ecosystem
  reviews and promotion reports can be stored as compact pending memory
  summaries without raw web pages, transcripts, secrets, signing assets, or
  local source paths.

### New in v0.7.8

- Adds aggregate Agent Loop memory-candidate metrics for hosts through
  `across-context loop-memory-metrics --all-projects --json`, MCP resource
  `across-context://agent-loop-memory-metrics`, and MCP tool
  `get_agent_loop_memory_metrics`.
- Records Agent Loop memory-candidate lifecycle policy events for allowed,
  denied, duplicate, and forgotten candidates without storing raw memory text in
  metric payloads.

### New in v0.7.7

- Documents the structured Agent Loop memory candidate contract used by Across
  Orchestrator `v0.6.12`, including schema
  `agent-loop-memory-candidate/1.0` and the non-secret fields that may be
  proposed for pending Across Context review.
- Records the current Agent Loop memory and telemetry boundaries in
  [Agent Loop Memory RFC](AGENT_LOOP_MEMORY_RFC.md), keeping Context scoped to
  memory policy and pending review rather than runtime routing.

### New in v0.7.6

- Release alignment for Across Orchestrator `v0.6.8` and Across Agents
  Assistant `v0.8.9`; the memory provider contract remains stable while hosts
  pick up corrected Agent Loop terminal-state handling from Orchestrator.

### New in v0.7.5

- Release alignment for host-neutral Across Orchestrator `v0.6.7` and Across
  Agents Assistant `v0.8.8`; the memory policy surface remains stable for
  packaged host installs and Agent Loop pending review.

### New in v0.7.4

- Product-mode host-plugin installs and path resolution now reject protected
  user project directories and fall back to the managed `~/.across` runtime
  unless developer mode is explicitly enabled.
- Agent Loop memory policy now declares host-owned loop controls for cancel,
  reject, and retry actions while keeping memory writes in the pending review
  flow.

### New in v0.7.3

- Host-plugin install commands now reject legacy `--prefix` usage and ignore
  legacy plugin-home overrides, keeping packaged hosts on the managed
  `~/.across` runtime boundary.

### New in v0.7.2

- Host-plugin install metadata avoids embedding development checkout paths, so
  packaged hosts can install and inspect the plugin from `~/.across` without
  crossing into local source trees.
- Package metadata now uses the neutral Across Context contributor identity for
  public open-source distribution.

### New in v0.7.1

- Fresh installs and managed host-plugin runs use only
  `~/.across/data/across-context` by default.
- Old standalone `~/.across-context` vaults are no longer read or copied
  automatically; hosts should pass an explicit `ACROSS_CONTEXT_HOME` only when
  they intentionally want a custom vault location.

### New in v0.7

- Agent Loop memory policy schema `0.2` with an explicit adapter contract for
  active search, pending summary writes, and review/approval flows
- Plugin manifest capabilities for Agent Loop memory hooks v2 and pending loop
  summaries, so host apps can discover the contract without reading source code
- Pending review can aggregate project-scoped loop summaries with
  `--all-projects`, which lets host apps show Agent Loop write candidates in a
  single review queue.

### New in v0.6

- Agent-loop memory hook policy for durable orchestration runtimes
- MCP resource, prompt, and tool surfaces for loop memory governance
- CLI command `loop-memory-policy --json` so host apps can inspect the memory
  lifecycle without reading vault internals

### New in v0.5

- Host-friendly plugin lifecycle metadata with install, repair, upgrade, and
  uninstall actions that preserve user memory data
- JSON memory lifecycle commands for host apps:
  `remember --json`, `list --status --json`, `approve --json`, `archive --json`,
  and `forget --json`
- Unified Across ecosystem paths under `~/.across`, including
  `~/.across/plugins/across-context` for runtime code and
  `~/.across/data/across-context` for durable memory

### New in v0.3

- MCP resources and prompts for discoverable memory context and repeatable agent workflows
- Explainable hybrid search: `across-context search "agent handoff" --mode hybrid --json --explain`
- Dashboard review actions for approving, archiving, expiring, forgetting, searching, and filtering memories
- Batch lifecycle updates: `across-context update-status active <memory-id...>`
- A2A-ready Agent Card metadata: `across-context agent-card --json`
- Team-safe project export: `across-context team export --project .`
- Deterministic hooks: `hook task-start` and `hook task-end`

### Install

The current open-source distribution is GitHub-first. Release tarballs are
attached to GitHub Releases, and the npm package metadata is ready, but npm
registry publication is not required for hosts to install or run the plugin.

Install from source for development:

```bash
git clone https://github.com/fantasyce/across-context.git
cd across-context
npm link
```

Or install from a local release tarball:

```bash
npm pack
npm install -g ./across-context-0.7.8.tgz
```

Verify:

```bash
across-context --help
```

For host apps such as Across Agents Assistant, install a local plugin runtime
under the user's hidden plugin directory:

```bash
across-context install host-plugin
```

This copies the Across Context runtime to `~/.across/plugins/across-context`,
creates `~/.across/bin/across-context`, and writes the plugin manifest at
`~/.across/plugins/across-context/manifest.json`. Host apps should discover that
wrapper instead of pointing at a source checkout, `npm link`, or a path under
`~/Documents`. Hosts can also call `plugin-manifest`, `plugin-status`, and
`health` to verify the installed plugin without reading private project files.

When a host sets `ACROSS_CONTEXT_PRODUCT_MODE=1` or
`ACROSS_AGENTS_PRODUCT_MODE=1`, explicit `install host-plugin` path arguments
such as `--across-home`, `--plugin-root`, and `--bin-dir` are rejected if they
point under protected user project locations such as `~/Documents`,
`~/Desktop`, or `~/Downloads`. Polluted environment roots such as
`ACROSS_HOME`, `ACROSS_PLUGIN_HOME`, `ACROSS_BIN_HOME`, and protected
`ACROSS_CONTEXT_HOME` vault overrides are ignored and fall back to `~/.across`.
Use `ACROSS_CONTEXT_DEVELOPER_MODE=1` only for intentional source checkout
development. Plugin manifest, status, install, and vault path resolution follow
the same product/developer-mode rule.

### Quick Start

Run this from any project directory:

```bash
across-context setup --all --yes
```

That one command initializes the vault, detects local agents, registers MCP
where possible, and writes project instruction files.

If you only want project files and do not want to change user-level agent
configuration:

```bash
across-context setup --all --yes --no-external
```

Verify the result:

```bash
across-context doctor
across-context status
```

### Agent Support

| Agent | What setup does |
| --- | --- |
| Codex | Writes `AGENTS.md` and registers `across-context mcp` when available. |
| Claude Code | Writes `CLAUDE.md` and registers a user-level MCP server when available. |
| Cursor | Writes `.cursor/mcp.json` and `.cursor/rules/across-context.mdc`. |
| Hermes | Registers `across-context mcp` when available. |
| OpenClaw | Writes the OpenClaw MCP configuration when available. |

### Automatic Memory Behavior

Generated agent rules instruct agents to:

- search relevant memory at task start
- use project context before architecture, release, dependency, test, or documentation decisions
- remember only durable context before final responses
- keep low-confidence automatic notes in pending review
- avoid duplicate memories
- never write secrets, credentials, huge logs, full chat history, temporary errors, private screenshots, or one-off noise

### Dashboard

Start the local review dashboard:

```bash
across-context dashboard
```

![Across Context dashboard](assets/readme/across-context-dashboard.png)

The dashboard runs on `127.0.0.1` by default and shows memory counts, pending
review items, lifecycle status, visibility, stored text, search explanations,
and local lifecycle actions.

### Memory Policy

All CLI and MCP writes go through the same policy engine.

Agent-loop runtimes should use Across Context as a memory provider, not as a
task scheduler. The `loop-memory-policy` command and MCP prompt/resource/tool
describe the supported hooks: pre-loop search, step context attachment, and
post-loop pending summary writes. Automatic loop writes default to `pending`
until a user or host policy approves them.

The policy also declares host-owned loop controls (`cancel`, `reject_action`,
and `retry_step`) so products can expose those actions while keeping loop state
inside Across Orchestrator and memory review inside Across Context.

When reviewing automatic loop summaries outside a specific project, use
`across-context pending --all-projects --json` so project-scoped candidates are
included alongside global pending memories.

Hosts that need aggregate Agent Loop memory-candidate diagnostics can use
`across-context loop-memory-metrics --all-projects --json` or the matching MCP
tool/resource. Metrics report lifecycle counts and status/scope breakdowns only;
they do not expose raw memory text.

Allowed memory types:

- `preference` - stable user preferences
- `decision` - durable project or architecture decisions
- `command` - reusable build, test, release, or troubleshooting commands
- `session` - compact handoff summaries
- `note` - short durable context that does not fit the other categories

Controlled writes:

- secret-like content is rejected
- duplicate memories return the existing record instead of appending another line
- long memories are trimmed to a safe default length
- low-confidence automatic notes and session summaries are stored as `pending`
- approved memories become `active`; stale memories can be `archived` or `expired`
- `compact` removes duplicates already on disk
- `forget <id>` removes a memory by id

### CLI Reference

```bash
across-context init
across-context setup --all --yes
across-context doctor
across-context status
across-context remember "Prefer small commits with tests." --type preference
across-context remember "Run npm test before final answers." --scope project --project . --type command
across-context search "tests before final" --project .
across-context search "agent handoff context" --mode semantic --project .
across-context search "release verification" --mode hybrid --json --explain
across-context list
across-context pending
across-context pending --all-projects --json
across-context approve <memory-id>
across-context archive <memory-id>
across-context expire <memory-id>
across-context update-status active <memory-id...>
across-context stats
across-context compact
across-context forget <memory-id>
across-context dashboard
across-context agent-card --json
across-context team export --project .
across-context hook task-start --query "release workflow" --project .
across-context hook task-end --summary "Implemented dashboard and semantic search." --project .
across-context loop-memory-policy --json
across-context loop-memory-metrics --all-projects --json
across-context install host-plugin
across-context plugin-manifest --json
across-context plugin-status --json
across-context health --json
across-context mcp
```

### MCP Server

The MCP server exposes tools:

- `remember_context`
- `search_context`
- `review_pending_memories`
- `approve_memory`
- `get_project_context`
- `get_agent_card`
- `export_agent_instructions`
- `get_agent_loop_memory_policy`
- `get_agent_loop_memory_metrics`

It also exposes resources:

- `across-context://agent-card`
- `across-context://stats`
- `across-context://memories`
- `across-context://project-context`
- `across-context://agent-loop-memory-policy`
- `across-context://agent-loop-memory-metrics`

And prompts:

- `task-start-context`
- `task-end-summary`
- `memory-review`
- `agent-loop-memory-policy`

Start it manually:

```bash
across-context mcp
```

### Vault Layout

```text
~/.across/data/across-context/
  global/
    memories.jsonl
  projects/
    <project-id>/
      profile.json
      memories.jsonl
```

For isolated tests:

```bash
ACROSS_CONTEXT_HOME=/tmp/across-context-demo across-context init
```

### Privacy

- The vault is local-first.
- This package does not sync memory to a hosted service.
- Public exports never include absolute project paths.
- Host-plugin manifests, wrappers, and status output should not embed
  development checkout paths.
- Generated files should be reviewed before committing.
- Secrets, tokens, credentials, cookies, private screenshots, and large logs should not be stored.

### Development

```bash
npm test
bash scripts/check.sh
npm pack --dry-run
```

### Community and Feedback

- Bug reports: [GitHub Issues](https://github.com/fantasyce/across-context/issues/new/choose)
- Product ideas: [Discussions Ideas](https://github.com/fantasyce/across-context/discussions/categories/ideas)
- Setup questions: [Discussions Q&A](https://github.com/fantasyce/across-context/discussions/categories/q-a)
## 中文

### 这个项目是什么

Across Context 是一个本地优先的跨 Agent 共享记忆层。它让 Codex、Claude
Code、Cursor、Hermes、OpenClaw 以及未来更多 coding agent 使用同一个本地记忆库。

它不是单纯的 MCP Server。完整产品由三部分组成：

1. **MCP 工具**：让 Agent 有能力读取和写入记忆。
2. **自动生成的 Agent 规则**：告诉 Agent 什么时候应该读、什么时候应该写。
3. **记忆治理策略**：防止 Agent 乱写、重复写、写入密钥或写爆本地 vault。

### 为什么需要它

现在每个 Agent 都有自己的上下文和聊天历史。你在 Claude Code 里沉淀的偏好，
Codex 不知道；Cursor 里学到的项目命令，Hermes 也不一定知道。Across Context
把这些稳定、可复用的上下文放到一个本地 vault 里，让不同 Agent 都能读到。

适合保存：

- 你的长期偏好
- 项目的构建、测试、发版方式
- 已经做过的架构决策
- 可以复用的命令
- 一次复杂任务结束后的简短交接摘要

### 一键开始

在任意项目目录下执行：

```bash
across-context setup --all --yes
```

它会自动完成：

- 初始化 `~/.across/data/across-context`
- 检测本机已安装的 Agent
- 注册 MCP 服务
- 生成 `AGENTS.md`
- 生成 `CLAUDE.md`
- 生成 Cursor MCP 配置和规则
- 注入自动读写记忆的行为规则

### 下一版能力

- 增加 Across Autopilot 记忆策略接口，让自动化生态审查和候选晋级报告能以
  紧凑的 pending 记忆摘要进入审查流程，同时避免写入原始网页、原始会话、
  密钥、签名资产或本地源码路径。

### v0.7.8 新能力

- 通过 `across-context loop-memory-metrics --all-projects --json`、MCP
  resource `across-context://agent-loop-memory-metrics` 和 MCP tool
  `get_agent_loop_memory_metrics` 提供 Agent Loop 记忆候选的聚合指标。
- 为允许、拒绝、重复和删除的 Agent Loop 记忆候选记录生命周期策略事件；
  指标 payload 不包含原始记忆文本。

### v0.7.7 新能力

- 文档化 Across Orchestrator `v0.6.12` 使用的结构化 Agent Loop 记忆候选
  契约，包括 `agent-loop-memory-candidate/1.0` schema，以及只能进入
  pending review 的非密钥字段。

### v0.7.6 新能力

- 对齐 Across Orchestrator `v0.6.8` 和 Across Agents Assistant `v0.8.9`
  发版；记忆提供方协议保持稳定，宿主会从 Orchestrator 获得修正后的
  Agent Loop 终态处理。

### v0.7.5 新能力

- 对齐 host-neutral Across Orchestrator `v0.6.7` 和 Across Agents Assistant
  `v0.8.8` 发版；记忆策略接口继续保持稳定，用于打包宿主安装和 Agent Loop
  pending 审核。

### v0.7.4 新能力

- 产品模式下的 host-plugin 安装和路径解析会拒绝受保护的用户项目目录，
  并回退到托管的 `~/.across` 运行时；只有显式开启开发模式才允许源码
  checkout 路径。
- Agent Loop 记忆策略会声明宿主拥有的 cancel、reject 和 retry 控制动作，
  同时继续让记忆写入进入 pending 审核流。

### v0.7.3 新能力

- host-plugin 安装命令会拒绝旧的 `--prefix` 用法，并忽略旧的
  plugin-home override，确保打包宿主继续使用托管的 `~/.across` 运行时边界。

### v0.7.2 新能力

- host-plugin 安装元数据不再嵌入开发 checkout 路径，打包宿主可以只从
  `~/.across` 安装、发现和检查插件。
- 公开发布元数据使用中性的 Across Context 贡献者身份。
- 新安装和宿主管理的插件运行默认只使用
  `~/.across/data/across-context`，不会自动读取或迁移旧的
  `~/.across-context` vault。
- Agent Loop 记忆 hooks、pending loop summary 和
  `pending --all-projects --json` 继续作为宿主集成的稳定接口。

### v0.3 新能力

- MCP resources 和 prompts：让 Agent 可发现地读取上下文并复用标准记忆工作流
- 可解释混合搜索：`across-context search "agent handoff" --mode hybrid --json --explain`
- Dashboard 审查操作：搜索、过滤、审批、归档、过期和删除记忆
- 批量生命周期更新：`across-context update-status active <memory-id...>`
- A2A-ready Agent Card 元数据：`across-context agent-card --json`
- 团队安全导出：`across-context team export --project .`
- 确定性 hooks：`hook task-start` 和 `hook task-end`

如果你只想生成项目规则，不想修改用户级 Agent 配置：

```bash
across-context setup --all --yes --no-external
```

验证安装：

```bash
across-context doctor
across-context status
```

如果要把 Across Context 作为 Across Agents Assistant 这类宿主应用的插件
使用，请安装到用户隐藏插件目录：

```bash
across-context install host-plugin
```

这个命令会复制运行时到 `~/.across/plugins/across-context`，创建
`~/.across/bin/across-context`，并写入
`~/.across/plugins/across-context/manifest.json`。宿主应用应该发现这个
wrapper，而不是指向源码目录、`npm link` 或 `~/Documents` 下的路径。
宿主应用还可以调用 `plugin-manifest`、`plugin-status` 和 `health` 来验证
已安装插件，而不需要读取私有项目文件。

产品宿主设置 `ACROSS_CONTEXT_PRODUCT_MODE=1` 或
`ACROSS_AGENTS_PRODUCT_MODE=1` 时，`install host-plugin` 会拒绝显式
`--across-home`、`--plugin-root`、`--bin-dir` 参数指到 `~/Documents`、
`~/Desktop`、`~/Downloads` 这类受保护用户项目目录。被污染的
`ACROSS_HOME`、`ACROSS_PLUGIN_HOME`、`ACROSS_BIN_HOME` 环境变量以及受保护的
`ACROSS_CONTEXT_HOME` vault override 会被忽略并回退到 `~/.across`。plugin
manifest、plugin status、install 和 vault 路径解析都遵守同一条产品/开发模式规则。
只有明确做源码 checkout 开发时才设置 `ACROSS_CONTEXT_DEVELOPER_MODE=1`。

### 支持的 Agent

| Agent | setup 会做什么 |
| --- | --- |
| Codex | 生成 `AGENTS.md`，并在可用时注册 MCP。 |
| Claude Code | 生成 `CLAUDE.md`，并在可用时注册用户级 MCP。 |
| Cursor | 生成 `.cursor/mcp.json` 和 `.cursor/rules/across-context.mdc`。 |
| Hermes | 在可用时注册 `across-context mcp`。 |
| OpenClaw | 在可用时写入 OpenClaw MCP 配置。 |

### 自动读写记忆

生成的 Agent 规则会要求 Agent：

- 任务开始时先搜索相关记忆
- 做架构、依赖、测试、文档、发版决策前读取项目上下文
- 最终回复前只写入稳定、可复用的记忆
- 低置信度自动记忆先进入 pending review
- 避免重复写入
- 不写密钥、token、cookie、大段日志、完整聊天记录、临时错误、私密截图或一次性噪音

### 本地 Dashboard

启动本地审查面板：

```bash
across-context dashboard
```

![Across Context dashboard](assets/readme/across-context-dashboard.png)

它默认运行在 `127.0.0.1`，可以查看记忆数量、待审批项、生命周期状态、可见性、记忆内容、搜索解释，并执行本地生命周期操作。

### 记忆治理

所有 CLI 和 MCP 写入都会先经过同一个策略引擎。

Agent Loop 运行时应把 Across Context 当作记忆提供者，而不是任务调度器。
`loop-memory-policy` 命令和 MCP prompt/resource/tool 会公开可支持的记忆钩子：
loop 前搜索、step 上下文附加、loop 后 pending 摘要写入。自动写入默认进入
`pending`，由用户或宿主策略审批后再变成长期有效记忆。

策略中也声明了宿主拥有的 loop 控制动作（`cancel`、`reject_action`、
`retry_step`），这样产品可以暴露这些操作，同时仍由 Across Orchestrator
维护 loop 状态、Across Context 维护记忆审核。

如果要在不限定具体项目的情况下审核自动写入的 loop 摘要，使用
`across-context pending --all-projects --json`，这样项目级 pending 候选也会
进入同一个审核队列。

如果宿主需要 Agent Loop 记忆候选的聚合诊断，可以使用
`across-context loop-memory-metrics --all-projects --json` 或对应的 MCP
tool/resource。指标只报告生命周期计数和 status/scope 分布，不暴露原始记忆文本。

支持的记忆类型：

- `preference`：长期用户偏好
- `decision`：项目或架构决策
- `command`：可复用命令
- `session`：简短任务交接摘要
- `note`：其他短小稳定上下文

治理规则：

- 疑似密钥会被拒写
- 重复记忆不会再次追加
- 过长记忆会被裁剪
- 低置信度自动 note/session 会进入 `pending`
- 审批后的记忆会变成 `active`，旧记忆可以归档或过期
- `compact` 可以清理历史重复记录
- `forget <id>` 可以删除指定记忆

### 常用命令

```bash
across-context init
across-context setup --all --yes
across-context doctor
across-context status
across-context remember "Prefer small commits with tests." --type preference
across-context remember "Run npm test before final answers." --scope project --project . --type command
across-context search "tests before final" --project .
across-context search "agent handoff context" --mode semantic --project .
across-context search "release verification" --mode hybrid --json --explain
across-context list
across-context pending
across-context pending --all-projects --json
across-context approve <memory-id>
across-context archive <memory-id>
across-context expire <memory-id>
across-context update-status active <memory-id...>
across-context stats
across-context compact
across-context forget <memory-id>
across-context dashboard
across-context agent-card --json
across-context team export --project .
across-context hook task-start --query "release workflow" --project .
across-context hook task-end --summary "Implemented dashboard and semantic search." --project .
across-context loop-memory-policy --json
across-context loop-memory-metrics --all-projects --json
across-context install host-plugin
across-context plugin-manifest --json
across-context plugin-status --json
across-context health --json
across-context mcp
```

### MCP Server

MCP Server 暴露工具：

- `remember_context`
- `search_context`
- `review_pending_memories`
- `approve_memory`
- `get_project_context`
- `get_agent_card`
- `export_agent_instructions`
- `get_agent_loop_memory_policy`
- `get_agent_loop_memory_metrics`

同时暴露 resources：

- `across-context://agent-card`
- `across-context://stats`
- `across-context://memories`
- `across-context://project-context`
- `across-context://agent-loop-memory-policy`
- `across-context://agent-loop-memory-metrics`

以及 prompts：

- `task-start-context`
- `task-end-summary`
- `memory-review`
- `agent-loop-memory-policy`

### 隐私模型

- vault 默认只保存在本机。
- 本包不会把记忆同步到云端服务。
- 公共导出不会包含绝对项目路径。
- host-plugin manifest、wrapper 和状态输出不应该嵌入开发 checkout 路径。
- 提交生成文件前应该先检查内容。
- 不应该保存密钥、token、凭据、cookie、私密截图或大段日志。

### 开发

```bash
npm test
bash scripts/check.sh
npm pack --dry-run
```

### 社区与反馈

- 问题反馈：[GitHub Issues](https://github.com/fantasyce/across-context/issues/new/choose)
- 产品想法：[Discussions Ideas](https://github.com/fantasyce/across-context/discussions/categories/ideas)
- 使用问题：[Discussions Q&A](https://github.com/fantasyce/across-context/discussions/categories/q-a)
