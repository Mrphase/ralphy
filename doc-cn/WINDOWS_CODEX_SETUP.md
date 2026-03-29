# Ralphy Windows + Codex 指南

本指南适用于在 Windows 上运行位于 `E:\Ecode\ralphy` 处克隆的仓库，通过 `Ralphy` 调用安装的 `codex` CLI。

## 1. 准备工作

打开 PowerShell 并确保这些命令可以工作：

```powershell
git --version
node --version
npm --version
codex --version
codex exec --help
```

推荐版本：

- Node.js 18+
- npm 9+
- 正常工作的 `codex` CLI 登录状态

如果 `codex --version` 失败，请在使用 Ralphy 之前先安装或修复 Codex CLI。

## 2. 克隆到 `E:\Ecode`

```powershell
git clone https://github.com/michaelshimeles/ralphy.git E:\Ecode\ralphy
cd E:\Ecode\ralphy
```

## 3. 安装 CLI 依赖

在从克隆的仓库运行代码时，Ralphy 的源码启动器需要 `cli` 依赖项。

```powershell
cd E:\Ecode\ralphy\cli
npm install --no-package-lock
cd E:\Ecode\ralphy
```

注意：

- 由于仓库忽略了 `cli\package-lock.json`，所以该安装保持在本地。
- 首次源码运行会自动生成 `cli\src\version.ts`。
- 如果不存在已编译的 Windows 二进制文件，启动器将回退降级使用 `tsx` 或 `npx tsx`。

## 4. 验证本地启动器

PowerShell 入口：

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --help
```

CMD 入口：

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
```

如果任意一个命令能打印除帮助信息，则说明本地仓库启动器正在工作。

## 5. 通过 Ralphy 验证 Codex 

首先运行一个安全的单任务测试：

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --no-tests --no-lint --no-commit "阅读 cli/package.json 并且只需回复包名（package name）。不要修改任何文件。"
```

预期结果：

- Ralphy 正常启动
- 引擎显示为 `Codex`
- 任务返回一个简短的文本答案
- 因为设置了 `--no-commit` 标志，所以没有创建任何提交

## 6. 初始化项目配置

这将为本仓库创建 `.ralphy\config.yaml`。

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --init
.\ralphy.ps1 --config
```

之后，添加你想要的任何项目规则：

```powershell
.\ralphy.ps1 --add-rule "prefer small focused changes (偏好小而专注的更改)"
.\ralphy.ps1 --add-rule "run tests before finishing (完成前运行测试)"
```

被 `--init` 创建的知识文件：

- `.ralphy\config.yaml`
- `.ralphy\progress.txt`
- `.ralphy\progress.md`
- `.ralphy\AGENTS.md`

使用以下命令来检查它们：

```powershell
.\ralphy.ps1 knowledge show
```

重置：

```powershell
.\ralphy.ps1 knowledge reset
```

## 7. 运行 Codex 单任务模式 

示例：

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex "在 README 中添加一个 Windows 故障排除的部分"
```

有用的标志 (flags) ：

- `--no-tests` 跳过测试命令
- `--no-lint` 跳过代码检查 (lint) 命令
- `--no-commit` 阻止自动提交
- `--model <name>` 覆盖此任务的 Codex 模型
- `--` 将额外标志直接传递给下方的 `codex` CLI

带有直接送达 Codex 命令行参数的示例：

```powershell
.\ralphy.ps1 --codex --model gpt-5.4 "总结仓库结构" -- --profile default
```

要检查下一个提示 (prompt) 而不执行实际任务：

```powershell
.\ralphy.ps1 --codex --dry-run --no-tests --no-lint "不要进行修改"
```

如果 `.ralphy\progress.md` 中至少有一个学习条目，干运行（dry-run）提示语应包括：

- `## Agent Instructions (代理指令)`
- `## Recent Task Learnings (近期任务学习)`

## 8. 使用 Codex 运行 PRD 模式

本仓库已经包含了 [`example-prd.md`](./example-prd.md)。

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --codex --prd .\example-prd.md --no-commit
```

Ralphy 将会：

1. 从 PRD 中读取任务列表
2. 挑选下一个未完成的任务
3. 在该任务上运行 Codex
4. 将已完成的项目标记为 done（完成）

## 9. 如果 PowerShell 被阻止，则使用 CMD 包装器

如果你机器的 PowerShell 执行策略阻止了运行 `.ps1` 文件，请使用：

```powershell
cd E:\Ecode\ralphy
cmd /c ralphy.cmd --help
cmd /c ralphy.cmd --codex "总结这个仓库"
```

关于完整的、面向学习的知识传递演练，请参阅 [KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)。

## 10. 疑难解答

找不到 `node` ：

```powershell
node --version
```

安装 Node.js，然后重新打开终端。

找不到 `codex` ：

```powershell
codex --version
```

请先修复 Codex CLI 的安装或 PATH 环境变量。

`Binary not found: ... ralphy-windows-x64.exe` (找不到二进制文件)：

- 这对于一个新克隆的仓库来说是正常的。
- 在 `npm install --no-package-lock` 之后，启动器应该会自动回退到源码路径。

对于 `src/version.ts` 报 `ERR_MODULE_NOT_FOUND`：

- 重新运行 `.\ralphy.ps1 --help`
- 启动器现在会在第一次源码运行时自动生成该文件。

`git` 提示 `dubious ownership` (可疑的所有权)：

```powershell
git config --global --add safe.directory E:/Ecode/ralphy
```

只有当 Git 明确显示该仓库存在此警告时，才这样做。