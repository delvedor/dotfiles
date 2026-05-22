# Sandbox Extension

Config-driven sandboxing for the pi coding agent. Wraps bash through
`@anthropic-ai/sandbox-runtime` and intercepts `read` / `write` / `edit`
tool calls against an allow/deny list.

## Config

Two sources, with project-local taking precedence over the global default:

1. `<cwd>/.pi/sandbox.json` (project-local)
2. `<extension-dir>/config.json` (global default, ships with the extension)

```jsonc
{
  "enabled": true,
  "network": {
    "allowedDomains": ["github.com", "*.github.com"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", ".env"],
    "allowWrite": ["."],
    "denyWrite": [".env", "*.pem", "*.key", "id_rsa"]
  }
}
```

## Path patterns (picomatch globs)

All `denyRead`, `allowWrite`, and `denyWrite` entries are compiled with
[picomatch](https://github.com/micromatch/picomatch) (`dot: true`).

| Entry shape              | Behaviour                                                               |
| ------------------------ | ----------------------------------------------------------------------- |
| `"*.pem"` (no slash)     | Basename glob — matches `*.pem` at **any depth**.                       |
| `"id_rsa"` (no slash)    | Basename match — matches `id_rsa` at any depth.                         |
| `".env"` (no slash)      | Matches `.env` at any depth.                                            |
| `"src/secrets/**"`       | Anchored to `cwd/src/secrets/**`.                                       |
| `"/absolute/path"`       | Anchored to the absolute path; descendants are also blocked.            |
| `"~/.ssh"`               | `~` is expanded to `$HOME`; descendants are also blocked.               |
| `"${AGENT_DIR}/auth.json"` | `${AGENT_DIR}` is expanded to the pi agent dir.                       |

`allowWrite` uses the same matcher — a write tool call is allowed only when
it matches at least one `allowWrite` entry **and** matches no `denyWrite`
entry. `denyWrite` always wins.

## Performance

Config is loaded and compiled **once per session** on `session_start`. The
`tool_call` hot path never reads the filesystem and never re-parses JSON.

## CLI

- `pi --no-sandbox` — disable sandboxing for the current session.
- `/sandbox` — print the active configuration.

## Caveats

- The sandbox uses `@anthropic-ai/sandbox-runtime`, which currently supports
  only macOS and Linux. On other platforms the extension self-disables.
- Glob patterns containing the literal sequence `*/` inside JSDoc comments
  break Node's type stripper — avoid that inside documentation comments
  in this file (use `<name>.key` or split the literal).
