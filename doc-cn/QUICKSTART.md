# Ralphy 中文快速上手

这份文档基于刚才的实操过程整理，目标是让你用最短路径掌握 3 件事：

1. Ralphy 的基本使用流程
2. PRD 模式怎么驱动任务执行
3. 知识继承怎么和 `AGENTS.md` / `progress.md` 配合

如果你已经把仓库放在 `E:\Ecode\ralphy`，并且 `codex` / `codex cli` 可用，可以直接从这里开始。

## 1. 先理解 4 个核心文件

### `PRD.md`

放“要做什么”。

- 适合写需求拆分、user story、执行顺序
- 在 PRD 模式下，Ralphy 会从里面读取 `- [ ] ...` 任务
- 每做完一条，会自动改成 `- [x]`

### `.ralphy/AGENTS.md`

放“长期怎么做”。

- 适合写项目规则、代码规范、禁区、测试要求
- 属于长期稳定知识
- 会被注入到后续 prompt

### `.ralphy/progress.md`

放“刚刚学到了什么”。

- 记录每一轮任务完成后的 learning entry
- 属于短期经验
- 会被注入到后续 prompt

### `.ralphy/config.yaml`

放“运行配置”。

- 测试/构建/检查命令
- rules
- boundaries

## 2. 推荐使用流程

最推荐的顺序是：

1. `ralphy --init`
2. 补 `.ralphy/AGENTS.md`
3. 准备 `PRD.md`
4. 先用 `--dry-run` 看 prompt
5. 再用 `--prd` 或单任务模式真实执行
6. 用 `knowledge show` 看知识积累
7. 必要时用 `knowledge reset` 清空知识状态

## 3. 初始化

Windows PowerShell：

```powershell
cd E:\your-project
E:\Ecode\ralphy\ralphy.ps1 --init
E:\Ecode\ralphy\ralphy.ps1 --config
E:\Ecode\ralphy\ralphy.ps1 knowledge show
```

WSL：

```bash
cd /mnt/e/your-project
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --init
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --config
/mnt/e/Ecode/ralphy/ralphy-wsl.sh knowledge show
```

初始化后会创建：

- `.ralphy/config.yaml`
- `.ralphy/progress.txt`
- `.ralphy/progress.md`
- `.ralphy/AGENTS.md`

## 4. 单任务模式

适合：

- 先做一个小实验
- 先验证 Codex 能不能正常被调起
- 先快速修一个小问题

Windows：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --no-tests --no-lint --no-commit "Create a file named hello.txt containing exactly HELLO and then stop."
```

WSL：

```bash
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --no-tests --no-lint --no-commit "Create a file named hello.txt containing exactly HELLO and then stop."
```

跑完之后检查：

```powershell
Get-Content .\.ralphy\progress.md
E:\Ecode\ralphy\ralphy.ps1 knowledge show
```

你应该能看到新的 learning entry。

## 5. PRD 模式

PRD 模式是真正最适合 Ralphy 的工作流。

最简单的 PRD 例子：

```md
# PRD - Notes Lab

## User Story 1
As a user, I want a starter notes file so I can begin capturing notes.

- [ ] Create a file named notes.txt with the first line `# Notes Lab`
- [ ] Append a short "Usage" section to README.md explaining that notes.txt stores plain-text notes

## User Story 2
As a user, I want a tiny workspace summary so I can understand the repo quickly.

- [ ] Create a file named summary.txt listing the purpose of README.md and notes.txt
```

运行一轮：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --prd .\PRD.md --no-commit --no-tests --no-lint --max-iterations 1
```

重点理解这几点：

- `User Story` 标题只是帮助你组织需求
- 真正会被执行的是下面的 `- [ ] ...` 任务
- `--max-iterations 1` 表示这次调用最多做 1 条
- 再跑一次，就会继续消费下一条未完成任务

## 6. 常见用法

### 只看 prompt，不真正执行

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --no-tests --no-lint "Do not make changes."
```

用途：

- 检查 `AGENTS.md` 是否被注入
- 检查 `progress.md` 是否被注入
- 检查边界和规则是否合理

### 查看知识状态

```powershell
E:\Ecode\ralphy\ralphy.ps1 knowledge show
```

用途：

- 看当前有多少 learning entry
- 快速确认知识文件是否存在

### 重置知识状态

```powershell
E:\Ecode\ralphy\ralphy.ps1 knowledge reset
```

用途：

- 清掉旧经验重新开始
- 避免历史上下文污染新的实验

### 临时关闭知识继承

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --no-knowledge "Do not make changes."
```

作用：

- 不注入 `AGENTS.md`
- 不注入 `progress.md`

### 控制注入的最近学习条数

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --knowledge-context 3 "Do not make changes."
```

### 控制注入的知识长度

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --knowledge-max-chars 4000 "Do not make changes."
```

## 7. 什么写进 PRD，什么写进 AGENTS，什么留给 progress

这是最重要的判断规则。

### 写进 `PRD.md`

当内容回答的是“这次要做什么”时，写进 `PRD.md`。

适合放：

- user story
- 任务拆分
- 交付顺序
- 每一步具体修改目标

例子：

- `Create notes.txt with the first line "# Notes Lab"`
- `Add a Usage section to README.md`
- `Create summary.txt listing the purpose of README.md and notes.txt`

### 写进 `.ralphy/AGENTS.md`

当内容回答的是“这个项目长期应该怎么做”时，写进 `AGENTS.md`。

适合放：

- 代码风格
- 目录约束
- 长期禁区
- 测试要求
- 提交要求
- 已知坑点

例子：

- `Always keep changes focused and minimal`
- `Do not modify files under src/legacy`
- `Run npm test before finishing`
- `Use plain-text notes files, not JSON`

### 留给 `.ralphy/progress.md`

当内容回答的是“这一轮刚刚验证出了什么经验”时，留给 `progress.md`。

适合放：

- 某个命令已经验证可用
- 某个文件格式已经被证明有效
- 某个限制刚刚在任务里遇到

例子：

- `The repository allowed a minimal file-only change without touching protected paths.`
- `Added a short Usage section to README.md clarifying notes.txt stores plain-text notes.`
- `summary.txt should stay concise and line-oriented.`

## 8. Ralphy 最佳 PRD 写法

一条 PRD 任务最好同时满足这几个条件：

- 只做一件事
- 结果可验证
- 文件目标明确
- 句子里直接写动作和产物

推荐写法：

```md
- [ ] Create notes.txt with the first line `# Notes Lab`
- [ ] Add a Usage section to README.md explaining what notes.txt stores
- [ ] Create summary.txt listing the purpose of README.md and notes.txt
```

不推荐：

```md
- [ ] Build the whole notes system
- [ ] Improve documentation
- [ ] Refactor the project
```

原因很简单：

- 任务越小，越稳定
- 任务越明确，越容易验证
- 学习记录越具体，知识继承越有价值

## 9. 什么时候用单任务，什么时候用 PRD

用单任务模式：

- 你在试环境
- 你在做一个很小的动作
- 你想快速验证一条命令

用 PRD 模式：

- 你已经有一个较清晰的任务列表
- 你希望按顺序逐条推进
- 你希望每条完成后自动回写 PRD 状态

## 10. 你最应该养成的习惯

推荐固定动作：

1. 新项目先 `--init`
2. 先改 `AGENTS.md`
3. 先写 `PRD.md`
4. 先 `--dry-run`
5. 再正式跑
6. 跑完看 `knowledge show`

如果你只记住一句话：

`PRD.md` 管“要做什么”，`AGENTS.md` 管“长期怎么做”，`progress.md` 管“刚刚学到了什么”。
