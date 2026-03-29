# Ralphy 知识继承上手指南

这份文档用一个独立演示仓库来熟悉 Ralphy 的“跨迭代知识继承”能力，不直接在 `E:\Ecode\ralphy` 源码仓库里练手。

默认演示路径：

- Windows PowerShell: `E:\Ecode\ralphy-knowledge-demo`
- WSL: `/mnt/e/Ecode/ralphy-knowledge-demo`

下面的命令以 PowerShell 为主；每一步都附 WSL 对应命令。

## 1. 目标

完成这一轮后，你会亲手看到这几件事：

1. `ralphy --init` 会生成 `.ralphy/AGENTS.md` 和 `.ralphy/progress.md`
2. `knowledge show` 能看到当前知识状态
3. 跑完第一个任务后，学习记录会写进 `.ralphy/progress.md`
4. 下一次 `--dry-run` 时，旧经验会被注入到 prompt
5. `knowledge reset` 可以把知识文件清空并重建

## 2. 先确认 Ralphy 和 Codex 都能跑

PowerShell:

```powershell
cd E:\Ecode\ralphy
.\ralphy.ps1 --help
codex --version
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --help
codex --version
```

预期现象：

- `ralphy` 能打印帮助
- `codex` 能打印版本号

## 3. 创建演示仓库

PowerShell:

```powershell
$demo = 'E:\Ecode\ralphy-knowledge-demo'
if (Test-Path $demo) { Remove-Item -LiteralPath $demo -Recurse -Force }
New-Item -ItemType Directory -Path $demo | Out-Null
Set-Location $demo
git init
Set-Content README.md "# Demo`r`n"
git add .
git commit -m "Initial demo commit"
```

WSL:

```bash
demo=/mnt/e/Ecode/ralphy-knowledge-demo
rm -rf "$demo"
mkdir -p "$demo"
cd "$demo"
git init
printf '# Demo\n' > README.md
git add .
git commit -m "Initial demo commit"
```

预期现象：

- 目录创建成功
- `git init` 完成
- 有一个初始提交

## 4. 初始化知识文件

PowerShell:

```powershell
cd E:\Ecode\ralphy-knowledge-demo
E:\Ecode\ralphy\ralphy.ps1 --init
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy-knowledge-demo
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --init
```

预期现象：

- 输出里出现 `.ralphy/config.yaml`
- 输出里出现 `.ralphy/progress.txt`
- 输出里出现 `.ralphy/progress.md`
- 输出里出现 `.ralphy/AGENTS.md`

## 5. 看当前知识状态

PowerShell:

```powershell
cd E:\Ecode\ralphy-knowledge-demo
E:\Ecode\ralphy\ralphy.ps1 knowledge show
Get-Content .\.ralphy\progress.md
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy-knowledge-demo
/mnt/e/Ecode/ralphy/ralphy-wsl.sh knowledge show
cat ./.ralphy/progress.md
```

预期现象：

- `AGENTS.md` 行数显示正常
- `progress.md` 当前是 `0 learning entries`
- `progress.md` 里只有占位说明，没有真实学习记录

## 6. 跑第一条任务

PowerShell:

```powershell
cd E:\Ecode\ralphy-knowledge-demo
E:\Ecode\ralphy\ralphy.ps1 --codex --no-tests --no-lint --no-commit "Create a file named hello.txt containing exactly HELLO and then stop."
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy-knowledge-demo
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --no-tests --no-lint --no-commit "Create a file named hello.txt containing exactly HELLO and then stop."
```

预期现象：

- 任务完成
- `hello.txt` 被创建
- 输出里提到 `.ralphy/progress.md`

## 7. 看第一条学习记录

PowerShell:

```powershell
Get-Content .\hello.txt
Get-Content .\.ralphy\progress.md
E:\Ecode\ralphy\ralphy.ps1 knowledge show
```

WSL:

```bash
cat ./hello.txt
cat ./.ralphy/progress.md
/mnt/e/Ecode/ralphy/ralphy-wsl.sh knowledge show
```

预期现象：

- `hello.txt` 内容是 `HELLO`
- `progress.md` 里出现一条 `## [时间戳] Task: "..."`
- `knowledge show` 里显示 `1 learning entries`

## 8. 用 dry-run 观察知识注入

PowerShell:

```powershell
cd E:\Ecode\ralphy-knowledge-demo
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --no-tests --no-lint "Do not make changes."
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy-knowledge-demo
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --dry-run --no-tests --no-lint "Do not make changes."
```

重点观察输出里的三段：

- `## Agent Instructions`
- `## Recent Task Learnings`
- 刚才那条 `Task: "Create a file named hello.txt containing exactly HELLO and then stop."`

如果你看到了这些，说明知识继承已经真正进入下一次 prompt。

## 9. 试三个常用开关

禁用知识注入：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --no-knowledge "Do not make changes."
```

```bash
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --dry-run --no-knowledge "Do not make changes."
```

只注入最近 1 条：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --knowledge-context 1 "Do not make changes."
```

```bash
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --dry-run --knowledge-context 1 "Do not make changes."
```

限制注入字符数：

```powershell
E:\Ecode\ralphy\ralphy.ps1 --codex --dry-run --knowledge-max-chars 800 "Do not make changes."
```

```bash
/mnt/e/Ecode/ralphy/ralphy-wsl.sh --codex --dry-run --knowledge-max-chars 800 "Do not make changes."
```

## 10. 重置知识文件

PowerShell:

```powershell
cd E:\Ecode\ralphy-knowledge-demo
E:\Ecode\ralphy\ralphy.ps1 knowledge reset
E:\Ecode\ralphy\ralphy.ps1 knowledge show
```

WSL:

```bash
cd /mnt/e/Ecode/ralphy-knowledge-demo
/mnt/e/Ecode/ralphy/ralphy-wsl.sh knowledge reset
/mnt/e/Ecode/ralphy/ralphy-wsl.sh knowledge show
```

预期现象：

- `progress.md` 和 `AGENTS.md` 被删掉再重建
- `knowledge show` 又回到 `0 learning entries`

## 11. 你应该记住的模型

可以把这套机制理解成两层：

- `AGENTS.md`: 你主动写给后续代理看的长期规则
- `progress.md`: 代理在每轮任务结束后自动留下的短期经验

下一轮 prompt 会把这两层内容一起带进去，所以它不是“单次会话记忆”，而是“项目目录里的外部记忆”。

## 12. 常见问题

`knowledge show` 报参数错误：

- 你运行的不是这次适配后的分支
- 先确认当前分支是 `knowledge-transfer-adaptation`

`--dry-run` 里看不到 `## Recent Task Learnings`：

- 你还没有成功跑完第一条任务
- 或者刚执行过 `knowledge reset`

任务完成了，但 `progress.md` 没变化：

- 先看命令输出里有没有提到 `.ralphy/progress.md`
- 再直接打开 `.ralphy/progress.md`
- 如果还是没有，先重跑一次最小任务，再检查 Codex 是否真的完成了任务

WSL 一直打印 localhost proxy warning：

- 这是 WSL 的宿主代理提示
- 这次验证里它没有阻塞 `codex` 或 `ralphy`
