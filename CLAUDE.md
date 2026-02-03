# DD-Owl Project Instructions

## Superpowers Skills Framework

This project uses the [obra/superpowers](https://github.com/obra/superpowers) skills framework for structured software development.

### Available Skills

Skills are located in `.claude/skills/`. Before any task, check if a relevant skill applies:

| Skill | When to Use |
|-------|-------------|
| **brainstorming** | Before ANY creative work - creating features, building components, modifying behavior |
| **writing-plans** | After design approval, to create detailed implementation plans |
| **executing-plans** | To execute plans in batches with human checkpoints |
| **test-driven-development** | During implementation - RED-GREEN-REFACTOR cycle |
| **systematic-debugging** | When fixing bugs - 4-phase root cause process |
| **subagent-driven-development** | For fast iteration with fresh agents per task |
| **verification-before-completion** | Before declaring any task complete |
| **requesting-code-review** | Between tasks, to review against plan |
| **receiving-code-review** | When responding to code review feedback |
| **using-git-worktrees** | For parallel development on isolated branches |
| **dispatching-parallel-agents** | For concurrent subagent workflows |
| **finishing-a-development-branch** | When tasks are complete, for merge/PR decisions |
| **writing-skills** | To create new skills |

### How to Use Skills

1. **Read the skill file** from `.claude/skills/<skill-name>/SKILL.md`
2. **Announce**: "Using [skill] to [purpose]"
3. **Follow the skill exactly** - these are mandatory workflows, not suggestions

### Slash Commands

| Command | Description |
|---------|-------------|
| `/brainstorm` | Start interactive design refinement |
| `/write-plan` | Create implementation plan |
| `/execute-plan` | Execute plan in batches |

### Core Workflow

1. **Brainstorming** - Refine ideas through questions, explore alternatives, validate design in sections
2. **Writing Plans** - Break work into 2-5 minute tasks with exact file paths and verification steps
3. **Executing Plans** - Work through tasks with TDD, review each before moving on
4. **Finishing** - Verify tests pass, create PR or merge

### Philosophy

- **Test-Driven Development** - Write tests first, always
- **YAGNI** - You Aren't Gonna Need It - remove unnecessary features
- **Systematic over ad-hoc** - Process over guessing
- **Evidence over claims** - Verify before declaring success
