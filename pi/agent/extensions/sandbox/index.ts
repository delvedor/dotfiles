/**
 * Sandbox Extension - Config-driven sandboxing via sandbox.json
 *
 * Config files (project takes precedence over global):
 * - <cwd>/.pi/sandbox.json (project-local)
 * - <extension-dir>/config.json (global/default)
 *
 * Example config.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": []
 *   },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws", ".env"],
 *     "allowWrite": ["."],
 *     "denyWrite": [".env", "*.pem", "*.key"]
 *   }
 * }
 * ```
 *
 * Glob support (filesystem entries):
 *   - All `denyRead` / `allowWrite` / `denyWrite` entries are picomatch globs.
 *   - Entries without a `/` are treated as basename patterns (for example,
 *     `"*.pem"` matches any .pem file at any depth).
 *   - Entries with a `/` are anchored to the resolved absolute path. The
 *     matcher also matches anything *inside* that path (descendant semantics),
 *     so `~/.ssh` blocks `~/.ssh/id_rsa` exactly like the old code did.
 *   - `~` and `${AGENT_DIR}` are expanded before compilation.
 *
 * Performance:
 *   - The config (and its compiled matchers) is loaded once on `session_start`
 *     and cached for the rest of the session. The `tool_call` hot path no
 *     longer hits the filesystem on every call.
 *
 * Usage:
 * - `pi --no-sandbox` - disable sandboxing
 * - `/sandbox` - show current configuration
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	getAgentDir,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import picomatch from "picomatch";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SandboxConfig extends SandboxRuntimeConfig {
	enabled?: boolean;
}

interface CompiledMatcher {
	/** The original pattern string, for diagnostic messages. */
	pattern: string;
	/** True if the resolved target path matches the pattern (exact, descendant, or basename). */
	matches: (target: string) => boolean;
}

// Filesystems that are case-insensitive by default — enable picomatch `nocase`
// so `~/.SSH/id_rsa` cannot bypass a `~/.ssh` deny on macOS / Windows.
const PICOMATCH_NOCASE = process.platform === "darwin" || process.platform === "win32";
const PICOMATCH_OPTS = { dot: true, nocase: PICOMATCH_NOCASE } as const;

interface CompiledRules {
	denyRead: CompiledMatcher[];
	allowWrite: CompiledMatcher[];
	denyWrite: CompiledMatcher[];
}

interface CachedConfig {
	cwd: string;
	config: SandboxConfig;
	rules: CompiledRules;
}

// === Validation ===

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isSandboxConfig(value: unknown): value is SandboxConfig {
	if (!isRecord(value)) return false;

	// `enabled` is optional but, if present, must be boolean.
	if ("enabled" in value && typeof value.enabled !== "boolean") return false;

	// `network` is optional.
	if ("network" in value && isRecord(value.network)) {
		if ("allowedDomains" in value.network && !isStringArray(value.network.allowedDomains)) return false;
		if ("deniedDomains" in value.network && !isStringArray(value.network.deniedDomains)) return false;
	}

	// `filesystem` is required.
	if (!isRecord(value.filesystem)) return false;
	const fs = value.filesystem;
	if ("denyRead" in fs && !isStringArray(fs.denyRead)) return false;
	if ("allowWrite" in fs && !isStringArray(fs.allowWrite)) return false;
	if ("denyWrite" in fs && !isStringArray(fs.denyWrite)) return false;

	return true;
}

// === Path / pattern helpers ===

function expandPath(path: string): string {
	let expanded = path;
	if (expanded.includes("${AGENT_DIR}")) {
		expanded = expanded.replace(/\${AGENT_DIR}/g, getAgentDir());
	}
	if (expanded.startsWith("~/") || expanded === "~") {
		expanded = expanded === "~" ? homedir() : join(homedir(), expanded.slice(2));
	}
	return expanded;
}

// Glob meta-characters that picomatch interprets. Anything containing one of
// these can't be safely realpath'd at compile time — the literal string isn't
// a real path.
const GLOB_META_RE = /[*?{}[\]!()]/;

function isPlainPath(p: string): boolean {
	return !GLOB_META_RE.test(p);
}

function realpathIfExists(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

/**
 * Compile a single config pattern into a matcher.
 *
 * Rules:
 *   - Patterns with no `/` are treated as basename globs and match the final
 *     path segment of the target at any depth (e.g. `*.pem` matches
 *     `/x/y/secret.pem`).
 *   - Patterns with a `/` (or `~`, `${...}`) are resolved to an absolute path
 *     and used as anchored globs. The matcher also matches any descendant of
 *     the resolved path so that listing a directory blocks everything inside.
 */
function compileMatcher(pattern: string, base: string): CompiledMatcher {
	const expanded = expandPath(pattern);

	if (!expanded.includes("/")) {
		// Basename-only pattern.
		const basenameMatch = picomatch(expanded, PICOMATCH_OPTS);
		const absRoot = resolve(base, expanded);
		const absResolved = isPlainPath(absRoot) ? realpathIfExists(absRoot) : absRoot;
		const anchored = picomatch(absResolved, PICOMATCH_OPTS);
		const descendant = picomatch(`${absResolved}/**`, PICOMATCH_OPTS);
		return {
			pattern,
			matches(target) {
				if (anchored(target) || descendant(target)) return true;
				const last = target.split("/").pop() ?? "";
				return basenameMatch(last);
			},
		};
	}

	const absolute = isAbsolute(expanded) ? expanded : resolve(base, expanded);
	// Realpath plain (non-glob) patterns so a deny like `~/safe` (symlink to
	// `~/.ssh`) still catches reads of files inside the linked target — which
	// are themselves realpath'd by resolveTargetSafe before matching.
	const absResolved = isPlainPath(absolute) ? realpathIfExists(absolute) : absolute;
	const anchored = picomatch(absResolved, PICOMATCH_OPTS);
	const descendant = picomatch(`${absResolved}/**`, PICOMATCH_OPTS);
	return {
		pattern,
		matches(target) {
			return anchored(target) || descendant(target);
		},
	};
}

/**
 * Resolve a tool-call target path through symlinks.
 *
 * Without realpath, a denied directory can be reached via a symlink (for
 * example `~/safe → ~/.ssh`). We realpath the target when it exists, and
 * realpath the parent (joined with the basename) for paths that don't exist
 * yet — the common case for write/edit creating a new file.
 */
function resolveTargetSafe(input: string, cwd: string): string {
	const abs = resolve(cwd, expandPath(input));
	try {
		return realpathSync(abs);
	} catch {
		try {
			return join(realpathSync(dirname(abs)), basename(abs));
		} catch {
			return abs;
		}
	}
}

function compileRules(config: SandboxConfig, cwd: string): CompiledRules {
	const fs = config.filesystem ?? { allowWrite: ["."] };
	return {
		denyRead: (fs.denyRead ?? []).map((p) => compileMatcher(p, cwd)),
		allowWrite: (fs.allowWrite ?? ["."]).map((p) => compileMatcher(p, cwd)),
		denyWrite: (fs.denyWrite ?? []).map((p) => compileMatcher(p, cwd)),
	};
}

// === Config loading ===

function loadConfigFromDisk(cwd: string, ctx: ExtensionContext): SandboxConfig | null {
	const paths = [
		join(cwd, ".pi", "sandbox.json"), // project-local
		join(__dirname, "config.json"), // extension config (global default)
	];

	for (const configPath of paths) {
		if (!existsSync(configPath)) continue;
		try {
			const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
			if (!isSandboxConfig(parsed)) {
				ctx.ui.notify(`Sandbox config ${configPath} failed validation`, "error");
				continue;
			}
			return parsed;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Could not parse sandbox config ${configPath}: ${message}`, "error");
		}
	}
	return null;
}

// === Sandboxed bash ops ===

function createSandboxedBashOps(): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

			return new Promise((resolveExec, reject) => {
				const child = spawn("bash", ["-c", wrappedCommand], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = (): void => {
					if (child.pid) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}
				};

				signal?.addEventListener("abort", onAbort, { once: true });

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
					} else {
						resolveExec({ exitCode: code });
					}
				});
			});
		},
	};
}

// === Extension ===

export default function (pi: ExtensionAPI): void {
	pi.registerFlag("no-sandbox", {
		description: "Disable sandboxing",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;
	let cached: CachedConfig | null = null;

	/**
	 * Return the compiled rules for the given cwd, re-loading and re-compiling
	 * when the cwd has changed.
	 *
	 * On a cwd change we MUST re-read `.pi/sandbox.json` from the new directory:
	 * different projects may ship different (stricter) sandbox rules and silently
	 * carrying the old config forward is a security regression. If the new cwd
	 * has no project config we fall back to the global default just like
	 * `session_start` does.
	 */
	function getRules(ctx: ExtensionContext): CompiledRules | null {
		if (!cached) return null;
		if (cached.cwd === ctx.cwd) return cached.rules;

		const freshConfig = loadConfigFromDisk(ctx.cwd, ctx);
		if (freshConfig && freshConfig.enabled !== false) {
			cached = { cwd: ctx.cwd, config: freshConfig, rules: compileRules(freshConfig, ctx.cwd) };
		} else {
			// No config in the new cwd (or it's disabled). Keep the previous config
			// but re-anchor relative patterns to the new cwd. Better than silently
			// failing open.
			cached = { cwd: ctx.cwd, config: cached.config, rules: compileRules(cached.config, ctx.cwd) };
		}
		return cached.rules;
	}

	function findFirstMatch(target: string, matchers: CompiledMatcher[]): CompiledMatcher | null {
		for (const m of matchers) {
			if (m.matches(target)) return m;
		}
		return null;
	}

	pi.registerTool({
		...localBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled || !sandboxInitialized) {
				return localBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(localCwd, {
				operations: createSandboxedBashOps(),
			});
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!sandboxEnabled || !sandboxInitialized) return;
		return { operations: createSandboxedBashOps() };
	});

	// Intercept read/write/edit tool calls
	pi.on("tool_call", async (event, ctx) => {
		if (!sandboxEnabled || !sandboxInitialized) return;

		const rules = getRules(ctx);
		if (!rules) return;

		// Handle read
		if (isToolCallEventType("read", event)) {
			const target = resolveTargetSafe(event.input.path, ctx.cwd);
			const hit = findFirstMatch(target, rules.denyRead);
			if (hit) {
				return {
					block: true,
					reason: `sandbox: read blocked - ${event.input.path} matches "${hit.pattern}"`,
				};
			}
			return;
		}

		// Handle write/edit
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const path = event.input.path;
			const target = resolveTargetSafe(path, ctx.cwd);

			const denyHit = findFirstMatch(target, rules.denyWrite);
			if (denyHit) {
				return {
					block: true,
					reason: `sandbox: write blocked - ${path} matches "${denyHit.pattern}"`,
				};
			}

			const allowHit = findFirstMatch(target, rules.allowWrite);
			if (!allowHit) {
				const allowList = rules.allowWrite.map((m) => m.pattern).join(", ") || "(none)";
				return {
					block: true,
					reason: `sandbox: write blocked - ${path} outside allowed paths: ${allowList}`,
				};
			}
			return;
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		cached = null;
		const noSandbox = pi.getFlag("no-sandbox") as boolean;

		if (noSandbox) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
			return;
		}

		const config = loadConfigFromDisk(ctx.cwd, ctx);

		if (!config) {
			sandboxEnabled = false;
			ctx.ui.notify("No sandbox.json found, sandbox disabled", "info");
			return;
		}

		if (config.enabled === false) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via config", "info");
			return;
		}

		const platform = process.platform;
		if (platform !== "darwin" && platform !== "linux") {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			return;
		}

		try {
			const configExt = config as unknown as {
				ignoreViolations?: Record<string, string[]>;
				enableWeakerNestedSandbox?: boolean;
			};

			if (!config.filesystem) {
				ctx.ui.notify("Sandbox config missing 'filesystem' section", "error");
				sandboxEnabled = false;
				return;
			}

			await SandboxManager.initialize({
				network: config.network ?? { allowedDomains: [], deniedDomains: [] },
				filesystem: config.filesystem,
				ignoreViolations: configExt.ignoreViolations,
				enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
			});

			cached = {
				cwd: ctx.cwd,
				config,
				rules: compileRules(config, ctx.cwd),
			};
			sandboxEnabled = true;
			sandboxInitialized = true;

			const networkCount = config.network?.allowedDomains?.length ?? 0;
			const writeCount = config.filesystem.allowWrite?.length ?? 0;
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg("accent", `🔒 Sandbox: ${networkCount} domains, ${writeCount} write paths`),
			);
			ctx.ui.notify("Sandbox initialized", "info");
		} catch (err) {
			sandboxEnabled = false;
			ctx.ui.notify(
				`Sandbox initialization failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		}
	});

	pi.on("session_shutdown", async () => {
		if (sandboxInitialized) {
			try {
				await SandboxManager.reset();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.warn("[sandbox] reset failed:", message);
			}
		}
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration",
		handler: async (_args, ctx) => {
			if (!sandboxEnabled) {
				ctx.ui.notify("Sandbox is disabled", "info");
				return;
			}

			if (!cached) {
				ctx.ui.notify("No config loaded", "error");
				return;
			}

			const { config } = cached;
			const lines = [
				"Sandbox Configuration:",
				"",
				"Network:",
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem (picomatch globs):",
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
