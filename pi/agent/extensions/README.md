# pi Extensions

Local extensions for the pi coding agent. Each `.ts` file at the top level
is loaded as a standalone extension; subdirectories with a `package.json`
are loaded as extension packages.

## Extensions

| Extension              | Type    | Purpose                                                                                                                                |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm-destructive`  | file    | Asks for confirmation before clear/switch/fork session actions. Only warns about *unanswered* user messages (not every user turn).     |
| `dirty-repo-guard`     | file    | Blocks switch/fork/new when the git tree is dirty. Handles non-interactive mode by blocking, and treats "git not installed" as a no-op. |
| `dracula-theme`        | file    | Activates the Dracula theme and exposes the palette (hex + ANSI, derived from one source) via `/dracula info\|colors\|palette`.        |
| `guard` (DCG)          | file    | Integrates [destructive_command_guard](https://github.com/Dicklesworthstone/destructive_command_guard). Async (`execFile`), runtime-validated, fail-open with a single per-session warning. |
| `handoff`              | file    | `/handoff <goal>` — generates a focused new-session prompt from the current conversation and opens it in the editor for review.        |
| `plan-mode`            | dir     | Read-only exploration mode. `/plan` toggles. Restores the previously-active tool set on exit instead of forcing a hard-coded default. See `plan-mode/README.md`. |
| `sandbox`              | pkg     | Filesystem + network sandboxing via picomatch globs. See `sandbox/README.md`.                                                          |
| `simplify`             | file    | `/simplify [scope]` — runs Anthropic's code-simplifier prompt against the recently-touched code.                                       |
| `statusline`           | file    | Dracula-themed footer with model, ctx%, token totals (cached), path, git branch.                                                       |

## Conventions

- All extensions are written as type-stripped TypeScript (`import type` for
  type-only imports; no enums; no parameter properties; no namespaces).
- Hot-path handlers (`tool_call`, `context`, footer render) avoid sync I/O
  and avoid recomputing state on every call — caches are invalidated on
  `session_start` / `model_select` / `turn_end` as appropriate.
- Unsafe casts (`as Foo`, `as any`) are avoided; runtime validation uses
  small type-guard helpers (`isFoo(v: unknown): v is Foo`).
- Errors are surfaced through `ctx.ui.notify(...)` so users see them, in
  addition to `console.warn` / `console.error` where appropriate.

## Adding an extension

A file-only extension is the simplest form:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (_args, ctx) => ctx.ui.notify("hi!", "info"),
  });
}
```

For extensions that need their own npm deps, mirror `sandbox/`: add a
`package.json` with `"pi": { "extensions": ["./index.ts"] }` and declare
deps under `"dependencies"`.
