# Ralphy PRD 模板

这是一个适合 Ralphy 执行的 PRD 模板。
如果你想同时了解：`PRD.md` 怎么拆任务、`prd.yaml` / `prd.yml` 什么时候更合适、初始化后怎么配 `.ralphy/config.yaml` 与 `.ralphy/AGENTS.md`，建议搭配 [`WORKFLOW_GUIDE.md`](./WORKFLOW_GUIDE.md) 一起看。

核心原则：

- 用 user story 组织需求
- 用 `- [ ]` 拆成微任务
- 一条任务只做一件事
- 任务里最好直接写目标文件、动作、产物

## 模板

```md
# PRD - <功能名>

## 背景
一句话说明这轮要解决什么问题。

## User Story 1
As a user, I want <目标>
So that <价值>

- [ ] Create <file/path> with <明确结果>
- [ ] Add <section/logic> to <file/path>
- [ ] Verify <可以检查的结果>

## User Story 2
As a user, I want <目标>
So that <价值>

- [ ] Update <file/path> to <明确结果>
- [ ] Add <small test/check/documentation item>
- [ ] Verify <可以检查的结果>

## 验收标准

- [ ] 结果 1
- [ ] 结果 2
- [ ] 结果 3
```

## 示例

```md
# PRD - Notes Lab

## 背景
为一个最小笔记工作区补齐起步文件和说明。

## User Story 1
As a user, I want a starter notes file
So that I can begin capturing notes immediately

- [ ] Create notes.txt with the first line `# Notes Lab`
- [ ] Add a Usage section to README.md explaining that notes.txt stores plain-text notes

## User Story 2
As a user, I want a tiny workspace summary
So that I can understand the repo quickly

- [ ] Create summary.txt listing the purpose of README.md and notes.txt

## 验收标准

- [ ] notes.txt exists
- [ ] README.md explains how notes.txt is used
- [ ] summary.txt exists and is concise
```

## 写法建议

### 推荐

```md
- [ ] Create notes.txt with the first line `# Notes Lab`
- [ ] Add a Usage section to README.md explaining that notes.txt stores plain-text notes
- [ ] Create summary.txt listing the purpose of README.md and notes.txt
```

### 不推荐

```md
- [ ] Build the whole notes feature
- [ ] Improve docs
- [ ] Refactor the project
```

## 判断标准

如果一条任务满足下面 4 点，通常就比较适合 Ralphy：

1. 动作明确
2. 目标文件明确
3. 结果可验证
4. 范围不大

## 如何执行

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --prd .\PRD.md --no-commit --no-tests --no-lint --max-iterations 1
```

重复执行上面的命令，就会继续处理下一条未完成任务。

## YAML / YML 版本怎么用

如果你更喜欢结构化任务，或者想用 `parallel_group` 控制并行，可以把同一份 PRD 写成 YAML。

示例：

```yaml
tasks:
  - title: Add filter dropdown to dashboard toolbar
    completed: false
    description: |
      Render a dropdown and wire it to the dashboard filter state.

  - title: Sync selected filter to query string
    completed: false

  - title: Add tests for filter persistence
    completed: false
```

执行命令：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --yaml .\prd.yml --no-commit --max-iterations 1
```

注意：

- 文件名可以叫 `prd.yaml` 或 `prd.yml`
- 调用时统一用 `--yaml`
- 如果任务需要并行，同组任务加 `parallel_group: 1`、`parallel_group: 2` 这样的数字即可