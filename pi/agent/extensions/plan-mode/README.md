# Plan Mode Extension

Read-only exploration mode for safe code analysis.

## Features

- **Read-only tools**: Restricts available tools to read, bash, grep, find, ls, question
- **Bash allowlist**: Only read-only bash commands are allowed
- **Plan extraction**: Extracts numbered steps from `Plan:` sections
- **Progress tracking**: Widget shows completion status during execution
- **[DONE:n] markers**: Explicit step completion tracking
- **Session persistence**: State survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/todos` - Show current plan progress
- `Ctrl+Alt+P` - Toggle plan mode (shortcut)

## Usage

1. Enable plan mode with `/plan` or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose "Execute the plan" when prompted
5. During execution, the agent marks steps complete with `[DONE:n]` tags
6. Progress widget shows completion status

## How It Works

### Plan Mode (Read-Only)
- Only read-only tools available
- Bash commands filtered through allowlist
- Agent creates a plan without making changes

### Execution Mode
- The tool set that was active **before** entering plan mode is restored
  verbatim (we capture it on entry, restore it on exit). So if you had a
  custom set enabled, plan mode no longer silently flattens it back to a
  hard-coded list.
- Agent executes steps in order
- `[DONE:n]` markers track completion
- Widget shows progress

### Command Allowlist

Precedence: a destructive match **always wins** over a safe match. Anything
that isn't matched by `SAFE_PATTERNS` is rejected by default.

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`
- Stdout-only downloads: `wget -O -`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
- Downloads that write to disk: `curl -o`, `curl -O`, `curl --output`,
  `wget -O <file>`, `wget --output-document=<file>`
- `awk` is intentionally not allowlisted because its program body can shell
  out and redirect to disk.
