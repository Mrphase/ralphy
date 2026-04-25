# Ralphy 错题集 (Lessons Learned)

持续积累 ralphy 使用过程中的错误、根因、正确改法。按时间倒序追加。

---

## [2026-04-21] 错题 #1：只看 PRD.yaml 的 `completed` 字段，没验证磁盘产物

### 现象
PRD.yaml 里 Task 1 标了 `completed: true`，ralphy 直接跳过跑 Task 2，结果 Task 2 要读 Task 1 的产物（`analysis/idf-template-checklist.md` 等）时文件全是 0 bytes / 不存在，必然失败。

### 根因
Task 是否"真的完成"有两个判据：
1. **PRD 标记**：`completed: true`
2. **磁盘产物**：task 的 acceptance 区段列出的文件都存在且非空

前一次跑 ralphy 或人手改 PRD 时，只改了标记 (1) 没产生文件 (2)。两者 drift 了，后续 task 读文件就炸。

### 正确改法

**每次运行 ralphy 之前，先跑一个"状态校验"**：对每个 `completed: true` 的 task，检查它 acceptance 区段列出的文件是否都在磁盘上。不在就把 `completed` 改回 `false`。

校验脚本模板（放在项目根目录，跑一下就知道状态）：

```python
import yaml, os, pathlib
d = yaml.safe_load(open('PRD.yaml', encoding='utf-8'))
for t in d['tasks']:
    if not t['completed']:
        continue
    # 从 description 的 Acceptance 段里找文件路径
    desc = t['description']
    # 简单启发：找形如 path/to/file.ext 的字符串
    import re
    paths = re.findall(r'[\w/_\-\.]+\.(?:md|yaml|pptx|png|pdf|json|log)', desc)
    missing = [p for p in paths if not os.path.exists(p) or os.path.getsize(p) == 0]
    if missing:
        print(f"[DRIFT] {t['title']}")
        for m in missing: print(f"    missing: {m}")
```

### 特例：Task 0 / Preflight 可以放心保留 `true`
Preflight 只验证环境（`which soffice d2 pdftoppm`），不产出文件。只要还在同一台机器、环境没变，Task 0 可以跨项目复用 `completed: true`。

### 更深层教训：PRD.yaml 是意图，文件系统是真相
把 ralphy 的 `completed` 当作 intent，而不是 ground truth。任何时候 ralphy 行为可疑，先去磁盘看文件。`git status` / `ls -la` / Python 脚本核对 acceptance — 别猜 PRD。

---

## [2026-04-21] 错题 #2：同一 drift 问题在 5 个 task 连锁爆发 — 代理会"带病前进"

### 现象
连续跑完后 PRD.yaml 显示 Task 2、5、6、7、8 全 `completed: true`，Task 9 开始跑时 "Unknown error [17s]" 秒退。实际磁盘上：
- Task 2 的 5 个 acceptance 文件全缺失
- Task 5 应产 12 个 D2 PNG，实际 **0 个**
- Task 6/7 应把 working.pptx 从 26 张裁到 14 张并插入 D2 图，实际还是 **26 张原模板**
- Task 8 的 QA 报告全缺失

Task 9 的"Unknown error" 不是新 bug，是下游拿不到真产物后 Claude 直接放弃。

### 根因：代理发现上游 drift 时的默认行为是"绕过去继续"

从 Task 4 日志原文可看到代理的决策过程：

> "Task 2 output files missing despite Task 2 being marked complete. Let me check for source content files and the gold-standard image."
> "The missing Task 2 files aren't blockers — the deck-spec.yaml, patent analysis, and sample analyses provide everything needed. Let me set up tracking and write all 4 deliverables."

代理选择了"尽力而为"而不是"停下报错"。从当前 task 视角看理智，从全局看则是 drift 滚雪球。

### 正确改法

**方案 A（推荐）— 每次启动前跑 drift check**
比单点检查 PRD 更彻底：把每个 task 的 acceptance 文件硬编码成一张表，启动 ralphy 之前先跑校验脚本，把物理上不存在的 task 一律打回 `completed: false`。代码见本文件 `scripts/drift_check.py`（若不存在则自己写，模板：）

```python
import yaml, os, glob, pathlib
from pptx import Presentation

ACCEPT = {
    # key = task title 前缀（"Task N"），value = 必须存在且非空的文件 list 或回调函数
    "Task 2": ["work/source-content-latency.md",
               "work/source-content-touchlatency.md",
               "analysis/input-slide-inventory.md",
               "analysis/current-innovation-summary.md",
               "analysis/gap-analysis.md"],
    "Task 5": lambda: len(glob.glob("d2/*.png")) >= 10 and len(glob.glob("d2/*.d2")) >= 10,
    "Task 6": lambda: _slide_count("work/working.pptx") <= 14,  # 14 for this project
    "Task 7": lambda: _slide_count("work/working.pptx") == 14,
    "Task 8": ["output/qa-text-dump.md", "output/qa-structure-report.md"],
    "Task 9": ["output/qa-visual-report.md", "output/patent-review-report.md"],
}

def _slide_count(path):
    try: return len(Presentation(path).slides)
    except: return -1

def check_and_reset(prd_path="PRD.yaml"):
    p = pathlib.Path(prd_path)
    d = yaml.safe_load(p.read_text(encoding="utf-8"))
    reset = []
    for t in d["tasks"]:
        if not t["completed"]: continue
        for key, rule in ACCEPT.items():
            if not t["title"].startswith(key): continue
            if callable(rule):
                ok = rule()
            else:
                ok = all(os.path.exists(f) and os.path.getsize(f) > 0 for f in rule)
            if not ok:
                t["completed"] = False
                reset.append(t["title"])
            break
    p.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return reset
```

**方案 B — 在 AGENTS.md 里写死"上游 drift 必须停"规则**
在 `.ralphy/AGENTS.md` 的 Known Pitfalls 里加：

> **Upstream drift = STOP**. If a task's `Required reading` section lists a file produced by an earlier task, and that file does NOT exist, DO NOT proceed. Instead: (1) reset the upstream task's `completed` to `false` in PRD.yaml with the python snippet; (2) exit this task immediately; (3) let ralphy's next iteration retry the upstream task. Do NOT try to "make do" with partial context — that causes cascade failure.

这样代理下次看到缺上游文件会退回而不是继续。

### 经验数值
- drift 一旦发生，下游 3–5 个 task 都会连带失败（类似 Task 9 "Unknown error [17s]"）
- 真正修复成本：重置 PRD → 重跑 5 个 task，大约 2–2.5 小时
- 如果不检测 drift，错误会一路传到 Task 10 产出一份空 deck

---

## [2026-04-21] 错题 #3：429 速率限制切断"尾部写操作" — agent 做完分析但来不及落盘

### 现象
Task 9 的 agent 其实做了大量正确工作：发现上游 Task 6/7 没填 deck → 自己把 deck 建起来 → 跑 QA 全部通过。但正要写 `qa-visual-report.md` / `patent-review-report.md` 时触发 429，连续两次 "API Error: Request rejected (429)" 后 agent 进程被 kill。留下的残局：
- `work/working.pptx` 是对的（14 页带图）✓
- QA 已在日志里说 "Zero issues"
- 但磁盘上 **QA 报告文件不存在**
- PRD.yaml 却显示 Task 9 `completed: true`（因为 Task 8 earlier drift 已经把它标了）

### 根因
两个问题叠加：
1. **吞吐前置耗尽**：一个 task 吃掉了上游遗留的工作（drift 自救），上下文+API 调用量远超单 task 预算，跑到尾部刚好撞 429
2. **429 发生时 agent 没有 fallback**：没有"如果 API 不可用就把剩余产物至少先保存"的逻辑

### 正确改法

**诊断启发式**：如果一个 task 被标 done 但 acceptance 文件缺失，先读最近的 log，搜 `429` 或 `API Error`。如果发现 agent 是跑到尾部才挂，只需重置该 task 让 ralphy 补尾部即可（**不要**重置上游），因为绝大部分工作已经完成。

**AGENTS.md 应加的 fallback 规则**：
> **Save-on-failure**: Before calling APIs that might rate-limit or time out, if you have
> partially-complete analysis results in memory, write them to a `.draft.md` file FIRST.
> That way, even if you're killed by a 429, the next task's agent can pick up from the draft.

**操作手册**：当用户说 "Task X 失败"、日志末尾是 429、但 `work/` 下关键产物存在时：
1. **不要** reset 该 task 的上游（很可能上游是被该 task 的 agent 吞掉做完的，产物已在磁盘）
2. **只** reset 该 task 本身 + 下游未真正完成的 task
3. 让 ralphy 在 429 冷却后（≥ 5 min）重跑 — 因为 context 轻了，这次会快速完成

### 经验数值
- 429 触发后典型冷却 5-15 min，超出后第一次请求通常成功
- 单 task agent 吃掉上游 drift 后 token 消耗约 1.5-2× 正常，是 429 高危场景
- 识别"429 截断"的信号：PRD 标 done + 关键分析文件存在（draft/dump）+ 最终 report 文件缺失


