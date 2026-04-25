---
name: ralphy-first-run
description: Use when onboarding a repo to Ralphy, improving first-run success, initializing `.ralphy/`, configuring `config.yaml` and `AGENTS.md`, and choosing between single-task, `PRD.md`, and `prd.yml` workflows.
---

# Ralphy First Run

Use this skill when the user wants Ralphy to work well on the first run, or asks how to initialize a project, configure `.ralphy/`, write PRD files, or choose the right flags.

## Goal

Turn a vague “just make Ralphy work” request into a reliable onboarding flow:

1. Initialize the project
2. Fill in stable project context
3. Start with a micro-task
4. Move to a structured PRD workflow

## Workflow

### 1. Initialize first

Run:

```bash
ralphy --init
ralphy --config
```

Verify that these files exist:

- `.ralphy/config.yaml`
- `.ralphy/AGENTS.md`
- `.ralphy/progress.txt`
- `.ralphy/progress.md`

### 2. Fix the configuration before blaming the model

Check `.ralphy/config.yaml` for:

- Accurate `commands.test`
- Accurate `commands.lint`
- Accurate `commands.build`
- Stable `rules`
- Correct `boundaries.never_touch`

If these are wrong or empty, fix them before asking the agent to do meaningful work.

### 3. Put project-specific guidance in `.ralphy/AGENTS.md`

Capture:

- Coding conventions
- Safe edit areas vs forbidden areas
- Testing expectations
- Known pitfalls
- Important repo-local docs, playbooks, or skills

### 4. Do not start with a giant task

Prefer a micro-task first, for example:

```bash
ralphy --codex --no-commit --max-iterations 1 -v "Add empty state text to the dashboard list"
```

This validates:

- Prompt injection from `.ralphy/`
- Test/lint commands
- Agent behavior in this repo

### 5. Choose the right task source

Use single-task mode when:

- The request is small
- You want a first-run trial
- You are validating the setup

Use `PRD.md` when:

- You want a lightweight requirements doc
- Tasks are sequential
- You want `- [ ]` / `- [x]` tracking

Use `prd.yml` when:

- You want structured tasks
- You want `description`
- You want `parallel_group`

Never pass `.yaml` or `.yml` files to `--prd`. YAML task files must be launched with `--yaml`.

## Authoring Rules

### Good `PRD.md` tasks

- Small
- Concrete
- File-aware
- Verifiable

Example:

```md
- [ ] Add empty state text to `src/components/dashboard-list.tsx`
- [ ] Match empty state spacing to existing card layout
- [ ] Add or update a focused test for empty state rendering
```

### Good YAML tasks

```yaml
tasks:
  - title: Add empty state text to dashboard list
    completed: false
    description: |
      Render a clear message when the list has no items.

  - title: Add tests for empty state rendering
    completed: false
```

### Anti-patterns

Avoid tasks like:

- “Refactor the whole app”
- “Fix all bugs”
- “Improve performance everywhere”

## Recommended Flags

### Safe first run

```bash
ralphy --codex --no-commit --max-iterations 1 -v "micro task"
```

### Markdown PRD

```bash
ralphy --codex --prd ./PRD.md --no-commit
```

### YAML PRD

```bash
ralphy --qgenie --yaml ./prd.yml --no-commit -v
```

Do not run `ralphy --prd ./prd.yml`. The current CLI will treat that as Markdown and may report that no tasks remain.

### Debugging setup quality

```bash
ralphy --dry-run --no-knowledge "Summarize how you would execute this task"
```

## Decision Heuristic

If the agent is doing the wrong thing on the first run:

1. Check `.ralphy/config.yaml`
2. Check `.ralphy/AGENTS.md`
3. Reduce the task size
4. Run one micro-task with `--no-commit --max-iterations 1 -v`
5. Only then move to a full PRD

## Reference

For the full walkthrough, read:

- `doc-cn/WORKFLOW_GUIDE.md`
- `doc-cn/QUICKSTART.md`
- `doc-cn/PRD_TEMPLATE.md`