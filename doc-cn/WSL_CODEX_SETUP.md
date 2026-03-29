# Ralphy WSL + Codex 指南

本指南适用于在 WSL 中的 `/mnt/e/Ecode/ralphy` 目录下运行克隆的仓库，并通过 Ralphy 调用 WSL 内部安装的 `codex` CLI。

## 1. 准备工作

打开一个 WSL 终端 (shell) 并验证基础环境：

```bash
uname -a
cat /etc/os-release | sed -n '1,6p'
command -v codex
codex --version
```

推荐的基础环境：

- WSL2
- Ubuntu
- 在 WSL 中有一个工作正常的 `codex` CLI (已登录)

如果 `codex --version` 失败，请在继续使用 Ralphy 之前先在 WSL 中修复 Codex CLI。

## 2. 进入本地仓库

```bash
cd /mnt/e/Ecode/ralphy
pwd
```

预期路径：

```text
/mnt/e/Ecode/ralphy
```

## 3. 安装 Linux Node.js 并修复 WSL Codex 包装器

运行仓库本地提供的环境配置辅助脚本：

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

它的作用：

- 验证您是否处于 WSL 内部的 Ubuntu 下
- 通过 `apt` 安装 Linux 版的 `nodejs` 和 `npm`
- 验证 `node` 和 `npm` 是否解析为 Linux 路径，而不是类似 `/mnt/c/...` 这样的 Windows 路径
- 如果 WSL 中缺少身份验证文件，脚本会尝试导入 Windows 那边的 Codex `file` 凭据存储文件到 `~/.codex/` 中
- 检查 `codex` 命令
- 如果存在 `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl` 二进制文件，脚本将重写 `~/.local/bin/codex` 以使其使用原生的 Linux 二进制文件

## 4. 验证 Linux Node.js 和 Codex

```bash
command -v node
node --version
command -v npm
npm --version
command -v codex
codex --version
```

预期结果：

- `node` 指向 `/usr/bin/node`
- `npm` 指向 `/usr/bin/npm`
- `codex` 继续正常工作

如果存在 `~/.local/lib/codex-linux/codex-x86_64-unknown-linux-musl`，验证其包装器不再指向 Windows的Node：

```bash
sed -n '1,40p' ~/.local/bin/codex
```

包装器应当执行 Linux 的原生二进制文件，而非 `/mnt/c/Program Files/nodejs/node.exe`。

## 5. 安装 Ralphy CLI 依赖

```bash
cd /mnt/e/Ecode/ralphy/cli
npm install --no-package-lock
cd /mnt/e/Ecode/ralphy
```

注意：

- 由于 `cli/package-lock.json` 被项目忽略，这些依赖仅保持存留在本地。
- 在源码首次运行缺少该文件时，它会在本地生成 `cli/src/version.ts`。
- WSL 本地克隆模式使用 Node/TS CLI 路径，而不是传统的 `ralphy.sh` 脚本。

## 6. 验证 WSL 启动器

使用本项目中针对 WSL 准备好的包装器：

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --help
```

如果正常打印出帮助信息，则说明本地的 WSL 启动器正在工作。

## 7. 通过 Ralphy 验证 Codex

首先，运行一个安全的冒烟测试（smoke test）：

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --no-tests --no-lint --no-commit "请直接回复 OK。不要使用任何工具。不要修改任何文件。"
```

预期结果：

- Ralphy 正常启动
- 引擎标明使用了 `Codex`
- 最终获得的回复是 `OK`

## 8. 初始化项目配置

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --init
./ralphy-wsl.sh --config
```

如果需要，你可以给项目加上全局规则：

```bash
./ralphy-wsl.sh --add-rule "prefer small focused changes (偏好小而专注的更改)"
./ralphy-wsl.sh --add-rule "run tests before finishing (完成前跑一遍测试)"
```

被 `--init` 自动创建出的知识文件有：

- `.ralphy/config.yaml`
- `.ralphy/progress.txt`
- `.ralphy/progress.md`
- `.ralphy/AGENTS.md`

用此命令可查看它们的内容：

```bash
./ralphy-wsl.sh knowledge show
```

要是想重置掉，可以：

```bash
./ralphy-wsl.sh knowledge reset
```

## 9. 运行单任务模式 

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex "添加一段针对 WSL 故障排除的 README 介绍节"
```

有用的标志 (flags) ：

- `--no-tests` 跳过所有测试
- `--no-lint` 跳过所有代码校验
- `--no-commit` 设置不予提交 (commit)
- `--model <name>`
- `--` 将它之后的标志/参量直接透传给 Codex CLI

示例：

```bash
./ralphy-wsl.sh --codex --model gpt-5.4 "总结仓库结构" -- --profile default
```

若想要先预检看看要发送给 AI 什么样的提示词(prompt)，而不必实际执行该任务：

```bash
./ralphy-wsl.sh --codex --dry-run --no-tests --no-lint "不要修改任何内容"
```

当您的 `.ralphy/progress.md` 里积累了至少一项知识学习的内容，您的干运行 (dry-run) 提示词里面就能看到它们了：

- `## Agent Instructions (代理指令)`
- `## Recent Task Learnings (近期任务学习)`

## 10. 运行 PRD 模式

使用目录中现成就有的 PRD 示例模版：

```bash
cd /mnt/e/Ecode/ralphy
./ralphy-wsl.sh --codex --prd ./example-prd.md --no-commit
```

## 11. 为什么 WSL 要使用 `ralphy-wsl.sh` 脚本

虽然仓库里依然有 `ralphy.sh` 这个脚本，但在 WSL 快速起步的指南中之所以建议您用 `ralphy-wsl.sh` 是由于：

- 它能直接唤起被长期维护更新的那个 Node/TS CLI 的入口点
- 它可以一直与 npm 包的发行路径保持对齐同步
- 这个脚本在此前早已额外地应用了那些最初就专门为修补 Windows 兼容性而存在在 `cli/bin.js` 中的补丁方案

传统的 `ralphy.sh` 确实依旧还可以用，但不建议在 WSL 本地克隆开发上将其用作它的首选路径。

## 12. 疑难排障处理

`node` 依然指向 `/mnt/c/`：

```bash
command -v node
command -v npm
```

需要去重新跑一遍：

```bash
cd /mnt/e/Ecode/ralphy
./wsl_setup_codex.sh
```

然后再打开一个全新干净的终端窗口再去检查一下。

`codex` 还是指向 Windows 的 Node：

```bash
sed -n '1,40p' ~/.local/bin/codex
```

如果是发现 Linux 环境那个原生 Codex 的可执行二进制文件在存在的情况，请再运行一次 `./wsl_setup_codex.sh`。

执行原生的 Linux 版 Codex 时返回 `401 Unauthorized` 或者是提示您缺少授权（未认证）：

- 再去跑一遍 `./wsl_setup_codex.sh` 让系统尽量从 Windows 里把基于文件存储（file-store）认证用的那批令牌文件抓拉合并过来。
- 或干脆直接在 WSL 里跑一行 `codex login` 自行解决登录即可。

如果 WSL 在上面输出了这么一句：

```text
wsl: A localhost proxy configuration was detected but not mirrored into WSL
```

这条警告其实大可省心，这仅仅是因为 WSL 里的 NAT 或网络代理行为设置产生的。它不等于说是您的 Ralphy 因此出了故障坏掉了。这个操作指南本身也不去给代理硬连固定地址，除非您自身使用的真是一个一定需要借由此走代理来穿透网络设置的环境中。

如果遇到了 Codex 在同步它某些插件的日志里面跳出 `403 Forbidden` 这种警告信息的话：

- 这种报错警告确有在开发排障跟校验的时候就被察觉和观察到了。
- 但事实是这不怎么会去干扰妨碍你直接顺畅利用与执行到跑有关 `codex exec` 的使用和烟雾测试上面的操作。
- 只要最后它真真切切是不怎么妨碍去干跑你要办成的真手头正活，那么平常将其视乎为了那些并非真正致命级的虚警告而略看即可。

如果提示 `./ralphy-wsl.sh` 说找不到并缺失需要的 Node.js 的话：

- 这个代表着属于 WSL 里的那套原生 Linux 版 Node.js 的环境并没有。
- 你必须得事先率先得去跑通过 `./wsl_setup_codex.sh` 这个初始流程才行。

关于一份完整的偏向用来做学习导向型进行的关于知识传递转移的实施说明演练演习教程的话，可以在这里查找这相关的这个文件这里有介绍详细的了：[KNOWLEDGE_TRANSFER_GUIDE.md](./KNOWLEDGE_TRANSFER_GUIDE.md)。