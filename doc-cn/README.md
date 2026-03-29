# Ralphy

[![npm version](https://img.shields.io/npm/v/ralphy-cli.svg)](https://www.npmjs.com/package/ralphy-cli)

**[加入我们的 Discord](https://discord.gg/SZZV74mCuV)** - 有问题？想要贡献？加入我们的社区！

![Ralphy](assets/ralphy.jpeg)

自主的 AI 编码循环工具。运行 AI 智能体执行任务直至完成。

## 安装

支持的快速入门路径：

- npm 全局安装
- Windows 本地克隆
- WSL 本地克隆

**选项 A: [npm](https://www.npmjs.com/package/ralphy-cli)**（推荐）
```bash
npm install -g ralphy-cli

# 随后可以在任意地方使用
ralphy "添加登录按钮"
ralphy --prd PRD.md
```

**选项 B: 克隆**
```bash
git clone https://github.com/michaelshimeles/ralphy.git
cd ralphy && chmod +x ralphy.sh

./ralphy.sh "添加登录按钮"
./ralphy.sh --prd PRD.md
```

**选项 C: Windows 本地克隆**
```powershell
git clone https://github.com/michaelshimeles/ralphy.git E:\Ecode\ralphy
cd E:\Ecode\ralphy\cli
npm install --no-package-lock
cd ..

.\ralphy.ps1 --help
.\ralphy.ps1 --codex "添加登录按钮"
.\ralphy.ps1 --codex --prd .\example-prd.md --no-commit
cmd /c ralphy.cmd --codex "总结这个仓库"
```

Windows 本地克隆快速上手指南：

- PowerShell 入口：`.\ralphy.ps1`
- CMD 入口：`cmd /c ralphy.cmd`
- 本地克隆模式的依赖项：Node.js 18+、npm、Codex CLI
- 单任务模式：`.\ralphy.ps1 --codex "添加登录按钮"`
- PRD 模式：`.\ralphy.ps1 --codex --prd .\example-prd.md --no-commit`
- 故障排除和完整设置参见：[WINDOWS_CODEX_SETUP.md](./WINDOWS_CODEX_SETUP.md)

**选项 D: WSL 本地克隆**
```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
cd cli
npm install --no-package-lock
cd ..

./ralphy-wsl.sh --help
./ralphy-wsl.sh --codex "添加登录按钮"
./ralphy-wsl.sh --codex --prd ./example-prd.md --no-commit
```

WSL 本地克隆快速上手指南：

- 维护的本地克隆入口：`./ralphy-wsl.sh`
- 设置辅助脚本：`./wsl_setup_codex.sh`
- 本地克隆模式的依赖项：Linux `node`、Linux `npm`、WSL 中的 Codex CLI
- 单任务模式：`./ralphy-wsl.sh --codex "添加登录按钮"`
- PRD 模式：`./ralphy-wsl.sh --codex --prd ./example-prd.md --no-commit`
- 完整设置和故障排除请参见：[WSL_CODEX_SETUP.md](./WSL_CODEX_SETUP.md)
- 知识传递演练：[KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)

两者的版本功能完全相同。下面使用 `ralphy` (npm) 的示例 —— macOS/Linux 上请用 `./ralphy.sh` 替换，在 Windows 本地克隆使用 `.\ralphy.ps1` / `ralphy.cmd`，而在 WSL 换用 `./ralphy-wsl.sh`。

## 两种模式

**单个任务/单任务模式** - 只需告诉它要做什么：
```bash
ralphy "添加深色模式"
ralphy "修复授权登录的 bug"
```

**任务列表** - 遍历处理 PRD 中所有项目：
```bash
ralphy              # 使用默认的 PRD.md
ralphy --prd tasks.md
```

## 项目配置

可选功能。存储 AI 必须遵循的规则。

```bash
ralphy --init              # 自动检测项目设置
ralphy --config            # 查看配置
ralphy --add-rule "use TypeScript strict mode" # 增加规则 "使用TS的严格模式"
```

创建 `.ralphy/config.yaml`：
```yaml
project:
  name: "my-app"
  language: "TypeScript"
  framework: "Next.js"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "use server actions not API routes" # 使用服务器活动代替API路由
  - "follow error pattern in src/utils/errors.ts" # 遵循位于 src... 的报错模式

boundaries:
  never_touch:
    - "src/legacy/**"
    - "*.lock"
```

规则将会应用于所有的任务（无论单任务还是 PRD）。

## 跨迭代知识库（知识传递）

Ralphy 可以在开发迭代之间带入工作知识。

在 `ralphy --init` 后，它会创建：

- `.ralphy/AGENTS.md` 用于持续的项目指令（知识说明）
- `.ralphy/progress.md` 用于记录迭代学习及整合的开发模式

常用的命令：

```bash
ralphy knowledge show
ralphy knowledge reset
```

常用参数标志：

```bash
ralphy --no-knowledge
ralphy --knowledge-context 5
ralphy --knowledge-max-chars 4000
```

推荐的工作流：

1. 运行 `ralphy --init`
2. 使用项目特定的规则和坑点 (gotchas) 来编辑 `.ralphy/AGENTS.md`
3. 使用你偏好的引擎运行一个单一任务
4. 检查 `ralphy knowledge show`
5. 使用 `--dry-run` 检查 `AGENTS.md` 以及最近的学习内容是如何注入到下一个 AI 提示语 (prompt) 中的。

关于 Codex 的完整逐步说明，请参阅 [KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)。

## AI 引擎种类

```bash
ralphy              # Claude Code (默认推荐)
ralphy --opencode   # OpenCode
ralphy --cursor     # Cursor
ralphy --codex      # Codex
ralphy --qwen       # 阿里云 Qwen-Code
ralphy --droid      # Factory Droid
ralphy --copilot    # GitHub Copilot
ralphy --gemini     # Gemini CLI
```

### 模型覆盖

覆盖任何引擎的默认大模型：

```bash
ralphy --model sonnet "添加特性"                       # 在 Claude 中使用 sonnet 
ralphy --sonnet "添加特性"                             # 针对上述选项的快捷方式
ralphy --opencode --model opencode/glm-4.7-free "任务" # 采用自定义的 OpenCode 模型
ralphy --qwen --model qwen-max "构建 api"              # 采用自定义的 Qwen 阿里模型
```

### 引擎的特有参数

使用 `--` 分隔符将额外的参数直接转达给你使用的下层引擎 CLI：

```bash
# 传入 copilot 特有参数
ralphy --copilot --model "claude-opus-4.5" --prd PRD.md -- --allow-all-tools --allow-all-urls --stream on

# 传入 claude 特有参数
ralphy --claude "添加特性" -- --no-permissions-prompt

# 这个技巧适用于任何引擎
ralphy --cursor "解个 bug" -- --custom-arg value
```

`--` 后的所有内容都原封不动地传递给引擎 CLI，Ralphy 本身不作任何解释。

## 任务来源格式

**Markdown 文件** (默认)：
```bash
ralphy --prd PRD.md
```
```markdown
## Tasks (任务)
- [ ] create auth
- [ ] add dashboard
- [x] done task (skipped) (已结束的任务将被直接跳过)
```

**Markdown 文件夹** (针对大型项目)：
```bash
ralphy --prd ./prd/
```
当指向一个文件夹时，Ralphy 会读取该目录下所有的 `.md` 文件，并汇整任务列表：
```
prd/
  backend.md      # - [ ] create user API
  frontend.md     # - [ ] add login page
  infra.md        # - [ ] setup CI/CD
```
任务是按文件逐个追踪的，因此标记完成后会顺位更新到正确的文件位置。

**YAML**:
```bash
ralphy --yaml tasks.yaml
```
```yaml
tasks:
  - title: create auth
    completed: false
  - title: add dashboard
    completed: false
```

**JSON**:
```bash
ralphy --json PRD.json
```
```json
{
  "tasks": [
    {
      "title": "create auth",
      "completed": false,
      "parallel_group": 1,
      "description": "Optional details"
    }
  ]
}
```
任务标题(title) 必须是唯一的。

**GitHub Issues**:
```bash
ralphy --github owner/repo
ralphy --github owner/repo --github-label "ready"
```

## 并发执行 (Parallel Execution)

```bash
ralphy --parallel                  # 默认 3 个终端代理进行并发工作
ralphy --parallel --max-parallel 5 # 调整为 5 个并发量
```

每个终端代理都会被分配隔离的专属工作区与代码分支 (isolated worktree + branch)：
```
Agent 1 → /tmp/xxx/agent-1 → ralphy/agent-1-create-auth
Agent 2 → /tmp/xxx/agent-2 → ralphy/agent-2-add-dashboard
Agent 3 → /tmp/xxx/agent-3 → ralphy/agent-3-build-api
```

不加 `--create-pr`：代码将自动合入基础分支，AI 会尝试处理代码冲突。
加了 `--create-pr`：保留并发产生的分支，并为您创建 PR 工作流。
加上 `--no-merge`：保留产生的分支但不合并它，且不创建 PR 请求。

**YAML 里的并发组** - 用于专门控制其执行顺序：
```yaml
tasks:
  - title: Create User model
    parallel_group: 1
  - title: Create Post model
    parallel_group: 1  # 分组相同 = 两者将同步运行
  - title: Add relationships
    parallel_group: 2  # 分组为2将在1顺利走完后执行
```

## 代码分支工作流

```bash
ralphy --branch-per-task                # 每个任务新建一个分支
ralphy --branch-per-task --create-pr    # + 创建 PR 请求
ralphy --branch-per-task --draft-pr     # + 起草 PR 提案模式
ralphy --base-branch main               # 将由主干分支(main)处衍生建立
```

产生的分支默认命名规则：`ralphy/<task-slug>`

## 浏览器自动化测试

Ralphy 也可以使用 [agent-browser](https://agent-browser.dev) 控制自动化浏览器，这将在进行相关的调试任务中派上大用。

```bash
ralphy "测试这段由于代码引起的登录页面流" --browser  # 强制打开使用
ralphy "添加结账逻辑" --no-browser                   # 强制禁用
ralphy "build feature"                              # 自动检查识别是否使用它 (默认)
```

开启该功能后，当前代理会获得相关的浏览器专属操作命令行：
- `agent-browser open <url>` - 跳转网页到该 URL 下
- `agent-browser snapshot` - 提取网页上被交互元件的位置代码（例如 @e1, @e2）
- `agent-browser click @e1` - 指示点击元件
- `agent-browser type @e1 "text"` - 指示对指定窗口内进行文字输入法填录
- `agent-browser screenshot <file>` - 执行抓拍截屏

**可用用例：**
- 在成功实现了一定程度功能后进行用户 UI 的验证测试
- 确定自动部署情况与线上数据页面是否已正确运作
- 进行表格回填及整体网站数据测试的工作

**需要在配置 (`.ralphy/config.yaml`) 内填补这一项：**
```yaml
capabilities:
  browser: "auto"  # 选择有 "auto", "true", 或是 "false"
```

## 网络挂钩通知功能 (Webhooks)

每当您的回环开发工作有进展情况结束时，您即可以透过它向类似于 Discord 或 Slack ，发送及自定请求提示进度给您通知了解情况。

**配置位于 (`.ralphy/config.yaml`)：**
```yaml
notifications:
  discord_webhook: "https://discord.com/api/webhooks/..."
  slack_webhook: "https://hooks.slack.com/services/..."
  custom_webhook: "https://your-api.com/webhook"
```

该回访请求的消息中将涵盖完成的所有任务数量及其具体的进度。

## 隔离沙盒模式

面对含有数量庞大依赖项的大型开发仓（尤其对超多巨量大厂依赖库的情况进行分析处理），我们可以选择执行沙盒代替使用 git 操作其本地树功能来进行并发化，此时它的运作机制明显更加快捷。

```bash
ralphy --parallel --sandbox
```

**它的运作机制是：**
- **建立内部软连接 Symlinks** 对于该文件进行无伤害只读映射，其中包括：(`node_modules`, `.git`, `vendor`, `.venv`, `.pnpm-store`, `.yarn`, `.cache`) 
- **完整重拷** 需要进行写入变动的源码层等： (`src/`, `app/`, `lib/`, 各类配置环境等)

**为何选择它：**
- 这可以直接越过并彻底解决了跨终端拷贝动辄占据掉你十几 Gb 以上超量硬盘与消耗大量运作耗时情况。
- 对于大型重型开发专仓的处理来说，此法其立基沙盘的速度几乎犹如飞奔般神速。
- 完成处理完毕时它还是能照惯例把变更顺利映射回原来源目录文件中。

**然而何时坚持该用默认操作的 Worktrees (依赖树操作功能)：**
- 此分端需要在整个工作阶段全面掌控 Git 版本全量的所有信息库
- 此时你的执行涉及到真正直接的各种底层化 `git` 树流命令行
- 如果你在测试时这等容量较小的轻量本地端应用。工作流消耗时间则在所难免变得可被忽略。

**并行执行阶段的健壮稳定性机制：**
- 出于种种原因造成该阶段出现 Git WorkTrees 分流建档树出灾时 (就比如你在处理带有包夹着次一等 git 工作树的文件的情况) Ralphy 实际上是会对自身操作功能采取平稳降级使用到沙环境去自动保护运作。
- 在遭遇受限于由于接口封禁与调用限度问题引起的操作限流失败的情况，该过程将进行标识延时然后再伺行进行接驳尝试。
- 本地任何暂存没进行修改的代码皆将在完成该树的变更与重并合并之前，全数量存好与复原回去。
- AI 执行代理是受到绝对严格规管绝对不会擅自重修更写属于您定义内的文件例如包括：PRD 源档案文件本身，`.ralphy/progress.txt` 及其记录文件, 包括生成产生给您用的树文件 `.ralphy-worktrees` 与本节所讲述的 `.ralphy-sandboxes`

## 参数选项大全

| 特征性 Flags | 它具体发挥什么作用 |
|------|--------------|
| `--prd PATH` | 指定其作为所需要分析完成的清单文档库或目录位置 (预设会自动搜寻当前下 `PRD.md`) |
| `--yaml FILE` | 改读取 yaml 文件执行任务清单 |
| `--json FILE` | 使用 json 规范载入来运行其任务项目 |
| `--github REPO` | 转为拉取 Github 上针对提交来的 issue 来工作 |
| `--github-label TAG` | 以提供带上的 issue tag 来过筛特定的分类工作任务给代理|
| `--sync-issue N` | 强制进行回链让您的列表直接转变成到对应的此处的 第 N 编号 的问题区 Issue 做进展的进度填坑回复 |
| `--model NAME` | 全面性越权取代下发任何引擎当前正挂着的内驱执行大模型 |
| `--sonnet` | 一个用来简化的等同写法等值于 `--claude --model sonnet` |
| `--parallel` | 打开进行全面平行运作 |
| `--max-parallel N` | 设置封顶开启到 `N` 个并发代理数量上限工作（预设值为 3 个并发同时启动） |