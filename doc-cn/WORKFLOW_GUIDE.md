# Ralphy 完整工作流指南

这份文档面向两类场景：

- 你第一次把 `ralphy` 接到一个项目里，想让它尽量第一次就做对事。
- 你已经能跑起来，但想系统理解 `--init` 之后该怎么写 `PRD.md` / `prd.yml`、怎么配 `.ralphy/config.yaml`、怎么写 `.ralphy/AGENTS.md`、各个 flag 分别控制什么。

如果你只想快速跑通，请先看 [`QUICKSTART.md`](./QUICKSTART.md)。如果你希望把第一次成功率拉高，直接看这份完整指南。

## 1. 先记住一个核心原则

Ralphy 第一次表现不好，通常不是“模型不行”，而是“项目上下文不够清楚”。

最常见的原因有：

- 没跑 `--init`，缺少 `.ralphy/` 基础文件。
- `.ralphy/config.yaml` 里的测试、lint、build 命令是空的或不准确。
- `.ralphy/AGENTS.md` 没写项目规则、禁区、测试要求。
- PRD 写得太大、太抽象、一步跨太多。
- 第一次就让 agent 做一个跨前后端、跨部署、跨测试的大任务。

所以，推荐流程不是“上来给一个大 prompt”，而是“先初始化 → 配上下文 → 跑一个微任务 → 再上完整 PRD”。

## 2. 推荐的第一次完整流程

### 第 0 步：确认入口

常见入口有三种：

- 全局安装：`ralphy`
- Windows 本地 clone：`D:\D_Code_2\ralph\ralphy\ralphy.ps1`
- WSL / Linux：`./ralphy-wsl.sh` 或 `./ralphy.sh`

如果你在 Windows PowerShell 下本地开发，最常见是：

```powershell
Set-Location D:\your-project
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --help
```

### 第 1 步：初始化项目

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --init
```

初始化后，Ralphy 会创建这些文件：

- `.ralphy/config.yaml`：项目配置、命令、规则、边界、通知。
- `.ralphy/AGENTS.md`：给 agent 的长期项目说明。
- `.ralphy/progress.txt`：简短任务进度日志。
- `.ralphy/progress.md`：跨轮次学习记录和模式总结。

初始化后建议立刻看一次：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --config
```

### 第 2 步：补全 `.ralphy/config.yaml`

`config.yaml` 决定的是“运行配置”和“稳定注入的规则”，不是临时任务内容。

一个推荐版本长这样：

```yaml
project:
  name: "my-app"
  language: "TypeScript"
  framework: "Next.js"
  description: "Internal dashboard for support operations"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "Keep diffs small and focused."
  - "Always update tests when behavior changes."
  - "Follow existing error handling patterns in src/lib/errors.ts."
  - "Read repo-local skill or playbook docs before changing architecture."

boundaries:
  never_touch:
    - "migrations/**"
    - "infra/terraform/**"
    - "*.lock"

notifications:
  discord_webhook: ""
  slack_webhook: ""
  custom_webhook: ""
```

#### 每一段分别管什么

- `project`：项目说明，帮助 agent 快速理解仓库。
- `commands`：测试 / lint / build 命令；这些越准确，agent 第一次越稳。
- `rules`：稳定执行规则，会被持续注入到 prompt。
- `boundaries.never_touch`：明确禁改区域。
- `notifications`：完成后通知，可选。

### 第 3 步：补全 `.ralphy/AGENTS.md`

如果说 `config.yaml` 是“结构化配置”，那 `.ralphy/AGENTS.md` 就是“项目经验说明书”。

适合写进 `.ralphy/AGENTS.md` 的内容：

- 代码风格和命名约定。
- 哪些目录是新代码入口，哪些目录是历史包袱。
- 测试怎么跑，哪些测试慢，哪些测试需要环境变量。
- 常见坑，例如“这个仓库不能直接运行全量 lint”。
- 仓库内已有的 skill / playbook / prompt 文档放在哪里。

一个好写法：

```md
## Coding Conventions

- Prefer existing hooks and utilities under `src/lib/`.
- Do not introduce new dependencies unless required.
- UI changes must keep mobile layout intact.

## Known Pitfalls

- `npm test` is slow; use `npm test -- src/foo.test.ts` for targeted checks first.
- Production config lives under `infra/` and should not be changed in normal tasks.

## Testing Notes

- Test: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`
```

### 第 4 步：第一次先跑一个微任务

不要第一次就给：

- “把整个登录系统重构掉”
- “顺便修 CI、改部署、补测试、做响应式”

第一次建议只做一个能快速验证的微任务，例如：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --no-commit --max-iterations 1 -v "Add empty state text to the dashboard list component."
```

这样做的目的：

- 先验证命令链路是通的。
- 先验证 agent 是否读到了 `.ralphy/config.yaml` 和 `.ralphy/AGENTS.md`。
- 先验证测试 / lint 命令有没有配错。

### 第 5 步：确认知识系统正常

跑完一轮后，建议看一次知识状态：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 knowledge show
```

如果发现历史 learning 已经污染当前任务，可以重置：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 knowledge reset
```

## 3. 单任务模式 vs PRD 模式

### 单任务模式

适合：

- 小修复。
- 单点改动。
- 先试运行。

示例：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --qgenie --no-commit "Fix the loading spinner alignment on mobile."
```

### PRD 模式

适合：

- 一组有顺序的任务。
- 你希望 agent 自动把完成项从 `- [ ]` 改成 `- [x]`。
- 你希望把需求拆成若干稳定微任务持续推进。

示例：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --prd .\PRD.md --no-commit
```

## 4. `PRD.md` 怎么写

Markdown PRD 的核心格式只有一个：

```md
- [ ] Task description
```

Ralphy 会读取所有未完成任务：

- `- [ ] ...`：待执行
- `- [x] ...`：已完成，会跳过

### 推荐结构

```md
# PRD - Dashboard Filters

## Background
Improve dashboard filtering so support agents can find tickets faster.

## User Story 1
As a support agent, I want to filter tickets by status.
So that I can narrow the queue quickly.

- [ ] Add status filter state to `src/pages/dashboard.tsx`
- [ ] Render a status dropdown in `src/components/ticket-toolbar.tsx`
- [ ] Apply selected status to the ticket query hook
- [ ] Add or update tests for status filter behavior

## User Story 2
As a support agent, I want the selected filter to persist in the URL.
So that I can share the filtered view.

- [ ] Sync filter state to the query string
- [ ] Restore filter state from the query string on page load
- [ ] Verify refresh keeps the selected filter
```

### Markdown PRD 最佳实践

- 一条任务只做一件事。
- 任务里尽量写明确文件或模块。
- 用“可验证结果”收尾，而不是只写“优化一下”。
- 把大任务拆成 3~10 条微任务，不要一条包打天下。

### 不推荐的写法

```md
- [ ] Rebuild the whole dashboard system
- [ ] Improve backend performance
- [ ] Fix all UI issues
```

这类任务太大，第一次很容易跑偏。

## 5. `prd.yaml` / `prd.yml` 怎么写

如果你想要：

- 明确任务字段。
- 带说明文本。
- 用 `parallel_group` 控制并行。

那就用 YAML。

### 调用方式

不管文件名叫 `prd.yaml` 还是 `prd.yml`，都用 `--yaml`：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --yaml .\prd.yml --no-commit
```

### YAML 结构

```yaml
tasks:
  - title: Add empty state to dashboard list
    completed: false
    description: |
      Update the list component so empty results show a clear message.

  - title: Add ticket toolbar filters
    completed: false
    parallel_group: 1

  - title: Add filter query parsing
    completed: false
    parallel_group: 1

  - title: Add tests for filter persistence
    completed: false
```

### 字段说明

- `title`：任务标题，必填。
- `completed`：是否完成，通常写 `false` 起步。
- `description`：附加上下文，可选。
- `parallel_group`：同一个分组号的任务可以并行执行。

### 什么时候用 Markdown，什么时候用 YAML

用 `PRD.md`：

- 你更喜欢直接写文档。
- 需求里有背景、user story、验收标准。
- 你想要最轻量的格式。

用 `prd.yml`：

- 你要并行执行。
- 你希望任务结构更规整。
- 你准备把任务文件交给脚本生成或维护。

## 6. `--prd`、`--yaml`、`--json` 的区别

### `--prd <path>`

用于 Markdown 任务源：

- 单文件：`--prd .\PRD.md`
- 目录：`--prd .\prd\`

如果传的是目录，Ralphy 会读取目录下的 Markdown 任务文件。

### `--yaml <file>`

用于 YAML 任务源：

- `--yaml .\prd.yaml`
- `--yaml .\prd.yml`

### `--json <file>`

用于 JSON 任务源，结构和 YAML 类似，只是换成 JSON。

## 7. 各类 flag 该怎么理解

下面是最常用的一组分类说明。

### 初始化与配置

- `--init`：初始化 `.ralphy/`。
- `--config`：显示当前配置。
- `--add-rule "..."`：往 `config.yaml` 追加一条规则。

### 引擎与模型

- `--claude`
- `--opencode`
- `--cursor`
- `--codex`
- `--qwen`
- `--droid`
- `--copilot`
- `--gemini`
- `--qgenie`

补充参数：

- `--model <name>`：覆盖默认模型。
- `--effort <level>`：覆盖 reasoning effort。
- `--sonnet`：等价于 `--claude --model sonnet`。
- `--`：把后面的原始参数透传给底层 agent CLI。

示例：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --qgenie --model azure::gpt-5.3-codex --effort xhigh "Summarize this repo"
```

### 执行控制

- `--dry-run`：只看会怎么做，不真正执行。
- `--max-iterations <n>`：限制执行轮数，`0` 表示不限。
- `--max-retries <n>`：单任务最大重试次数。
- `--retry-delay <n>`：重试间隔秒数。
- `--no-commit`：不自动提交。
- `-v` / `--verbose`：输出更详细日志。

### 测试与 lint

- `--no-tests` / `--skip-tests`：跳过测试。
- `--no-lint` / `--skip-lint`：跳过 lint。
- `--fast`：同时跳过测试和 lint。

### PRD / 任务源

- `--prd <path>`：Markdown 文件或文件夹。
- `--yaml <file>`：YAML 任务源。
- `--json <file>`：JSON 任务源。
- `--github <owner/repo>`：从 GitHub issue 取任务。
- `--github-label <label>`：按 label 过滤 issue。
- `--sync-issue <number>`：每轮执行把 PRD 同步回指定 issue。

### 并行与分支

- `--parallel`：并行执行任务。
- `--max-parallel <n>`：并行 agent 数量。
- `--sandbox`：并行时用轻量 sandbox 而不是 worktree。
- `--branch-per-task`：每个任务单独分支。
- `--base-branch <branch>`：设置基准分支。
- `--create-pr`：任务后自动创建 PR。
- `--draft-pr`：创建 draft PR。
- `--no-merge`：并行执行后不自动合并分支。

### 知识系统

- `knowledge show`：查看知识状态。
- `knowledge reset`：清空知识状态。
- `--no-knowledge`：禁用知识注入。
- `--knowledge-context <n>`：注入最近学习条数。
- `--knowledge-max-chars <n>`：知识注入的字符上限。

### 迭代优化与竞争

- `--optimize`：迭代优化模式（需要 `--evaluate`）。
- `--compete`：多 Agent 竞争模式（需要 `--evaluate`）。
- `--evaluate <script>`：评估脚本，输出分数。
- `--optimize-rounds <n>`：优化最大轮数（默认 20）。
- `--compete-agents <n>`：每轮竞争 agent 数（默认 3）。
- `--compete-rounds <n>`：竞争轮数（默认 5）。
- `--metric-objective <type>`：`minimize`、`maximize`、`pass-fail`（默认 `maximize`）。

示例：

```powershell
# 单 agent 迭代优化：改代码 → 评估 → 保留/丢弃 → 重复
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --optimize --evaluate "node eval.js" --optimize-rounds 20 "优化排序算法"

# 3 个 agent 竞争并行解题，每轮选最优
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --claude --compete --evaluate "python test.py" --compete-agents 3 --compete-rounds 5 "实现缓存层"
```

评估脚本只需输出分数（JSON `{"score": 0.95}` 或纯数字 `0.95`），exit code 0 = 成功，非 0 = 崩溃。

结果保存在 `.ralphy/optimize-results.tsv`（优化）或 `.ralphy/compete-results.tsv`（竞争）。

### 浏览器能力

- `--browser`：强制开启 browser automation。
- `--no-browser`：强制关闭 browser automation。

## 8. “config”和“agent”到底怎么配

很多人第一次会把这两件事混在一起。

### `.ralphy/config.yaml`

适合放：

- 命令。
- 稳定规则。
- 禁改路径。
- 通知设置。

### `.ralphy/AGENTS.md`

适合放：

- 项目背景。
- 长期开发规则。
- 代码组织方式。
- 常见坑和约束。
- 测试说明。
- skill / playbook / prompt 文档入口。

### 每次执行时的 agent 选择

不是写在 `config.yaml` 里，而是通过命令行 flag 选：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex ...
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --qgenie ...
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --gemini ...
```

所以可以这样理解：

- `config.yaml`：项目级长期配置。
- `AGENTS.md`：项目级长期 agent 指导。
- CLI flags：本次执行选择哪个 agent、哪个模型、开什么能力。

## 9. 让第一次执行更稳的实战建议

这是最重要的一段。

### 推荐做法

1. 先 `--init`。
2. 补全 `commands.test` / `commands.lint` / `commands.build`。
3. 在 `.ralphy/AGENTS.md` 写清楚代码规范、禁区、测试要求。
4. 先跑一个微任务，不要先上大 PRD。
5. 第一次建议加上 `--no-commit --max-iterations 1 -v`。
6. 结果合理后，再切到完整 PRD 模式。

### 推荐的第一条命令

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --no-commit --max-iterations 1 -v "Add a clear empty state to the dashboard list component."
```

### 推荐的第一份 PRD

不要超过 5~8 条任务，而且每条任务尽量可验证：

```md
# PRD - First Run Trial

## User Story 1
As a user, I want the dashboard list to show an empty state.
So that blank pages are understandable.

- [ ] Add an empty state text block to the dashboard list component
- [ ] Match empty state spacing to existing card layout
- [ ] Add or update a focused test for empty state rendering
- [ ] Verify lint or targeted checks pass
```

## 10. QGenie / 模型相关补充

如果你用的是 `--qgenie`：

- 模型由 `--model` 控制。
- reasoning effort 由 `--effort` 控制。
- 额外原始参数用 `--` 透传。

例如：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --qgenie --model azure::gpt-5.3-codex --effort xhigh --no-commit "Summarize the current architecture"
```

当前 `qgenie` 路径还会在模型不可用、provider 错误、429、5xx、timeout、network 等情况下尝试切换到预设 fallback 模型链；如果是认证失败，则不会盲目切换模型。

## 11. 最后给一个可直接照抄的工作流

### 方案 A：第一次接新仓库

```powershell
Set-Location D:\your-project
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --init
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --config
```

然后：

1. 补 `.ralphy/config.yaml`
2. 补 `.ralphy/AGENTS.md`
3. 写一个最小 `PRD.md`

执行：

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --prd .\PRD.md --no-commit --max-iterations 1 -v
```

### 方案 B：你已经有 `prd.yml`

```powershell
Set-Location D:\your-project
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --qgenie --yaml .\prd.yml --no-commit -v
```

### 方案 C：只做一个小修复

```powershell
Set-Location D:\your-project
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --gemini --no-commit "Fix button label overflow in mobile header"
```

## 12. 迭代优化与多 Agent 竞争

这是 Ralphy 借鉴 [karpathy/autoresearch](https://github.com/karpathy/autoresearch) 思路新增的两个模式。与普通任务模式的核心区别是：**有客观的评估脚本自动打分**，而不是纯依赖 agent 自我判断。

### 迭代优化模式（`--optimize`）

单个 agent 反复改代码，每轮都用评估脚本打分。分数提升就 commit（保留），没提升就 git reset（丢弃）。

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --codex --optimize --evaluate "node eval.js" --optimize-rounds 20 "优化查询性能"
```

流程：

1. 记录当前 commit hash（快照）
2. 构建 prompt（包含任务 + 历史分数表 + 上轮评估反馈）
3. 执行 agent
4. 跑评估脚本 → 拿到分数
5. 分数更好 → commit，否则 → git reset --hard 到快照
6. 记录到 `.ralphy/optimize-results.tsv`
7. 重复

### 多 Agent 竞争模式（`--compete`）

N 个 agent 并行解同一个任务，分别评估，选最优者。

```powershell
D:\D_Code_2\ralph\ralphy\ralphy.ps1 --claude --compete --evaluate "python test.py" --compete-agents 3 --compete-rounds 5 "实现缓存层"
```

流程：

1. 创建 N 个 git worktree，每个 agent 在独立分支工作
2. N 个 agent 并行解题
3. 评估脚本在每个 worktree 里分别跑
4. 最高分 agent 的分支合并到主分支，其他分支删除
5. 下一轮从 winner 的代码继续

### 写评估脚本

评估脚本只需满足：

- 输出一个分数到 stdout
- exit code 0 = 成功，非 0 = 崩溃

示例 `eval.js`：

```javascript
const { execSync } = require('child_process');
try {
  const output = execSync('npm test', { encoding: 'utf-8' });
  const passed = (output.match(/passing/g) || []).length;
  console.log(JSON.stringify({ score: passed }));
} catch (e) {
  process.exit(1);
}
```

示例 `bench.py`：

```python
import subprocess, json, time
start = time.time()
subprocess.run(["python", "main.py"], check=True)
elapsed = time.time() - start
print(json.dumps({"score": 1.0 / elapsed}))  # 越快分数越高
```

### 什么时候用优化，什么时候用竞争

- **优化** (`--optimize`)：适合算法调优、性能优化、模型超参调整等“反复试、逐步改进”的场景。
- **竞争** (`--compete`)：适合“方案不确定，想让多个 agent 各自探索，然后选最好的”场景。

两者都必须搭配 `--evaluate <script>`，没有评估脚本会报错。

## 13. 一句话总结

- `PRD.md` / `prd.yml` 管“这次做什么”。
- `.ralphy/config.yaml` 管“怎么跑、跑哪些命令、哪些地方别碰”。
- `.ralphy/AGENTS.md` 管“这个项目长期应该怎么做”。
- `.ralphy/progress.md` 管“刚刚学到了什么”。
- `--optimize` + `--evaluate` 管"自动迭代改进，靠分数决定保留还是丢弃"。
- `--compete` + `--evaluate` 管"多 agent 并行竞争，靠分数选最优"。

把这几层分清，Ralphy 第一次成功率会高很多。