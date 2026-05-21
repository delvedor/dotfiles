/**
 * Sandbox Extension - Config-driven sandboxing via sandbox.json
 *
 * Config files (project takes precedence over global):
 * - <extension-dir>/config.json (global/default)
 * - <cwd>/.pi/sandbox.json (project-local)
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
 *     "denyWrite": [".env", "*.pem"]
 *   }
 * }
 * ```
 *
 * Usage:
 * - `pi --no-sandbox` - disable sandboxing
 * - `/sandbox` - show current configuration
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type BashOperations, createBashTool, isToolCallEventType, getAgentDir } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SandboxConfig extends SandboxRuntimeConfig {
	enabled?: boolean;
}

// Load config from JSON files only (project > global, no defaults)
function loadConfig(cwd: string): SandboxConfig | null {
	const paths = [
		join(cwd, ".pi", "sandbox.json"),  // project-local
		join(__dirname, "config.json"),    // extension config (global/default)
	];

	for (const configPath of paths) {
		if (existsSync(configPath)) {
			try {
				return JSON.parse(readFileSync(configPath, "utf-8")) as SandboxConfig;
			} catch (e) {
				console.error(`Warning: Could not parse ${configPath}: ${e}`);
			}
		}
	}
	return null;
}

function createSandboxedBashOps(): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

			return new Promise((resolve, reject) => {
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

				const onAbort = () => {
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
						resolve({ exitCode: code });
					}
				});
			});
		},
	};
}

// Tool call permission helpers
function expandPath(path: string): string {
	// Expand ${AGENT_DIR} to actual agent directory
	if (path.includes("${AGENT_DIR}")) {
		path = path.replace(/\${AGENT_DIR}/g, getAgentDir());
	}
	// Expand ~ to home directory
	if (path.startsWith("~/")) {
		path = path.replace("~/", process.env.HOME + "/");
	}
	return path;
}

function isPathBlocked(targetPath: string, blockedPaths: string[], cwd: string): { blocked: boolean; matched?: string } {
	const resolvedTarget = resolve(cwd, expandPath(targetPath));

	for (const blocked of blockedPaths) {
		// For relative paths (like ".env" or ".pi/extensions"), resolve against cwd
		// and use the same prefix-check logic as absolute paths.
		if (!blocked.startsWith("~/") && !blocked.startsWith("${") && !isAbsolute(blocked)) {
			const resolvedBlocked = resolve(cwd, expandPath(blocked));
			const rel = relative(resolvedBlocked, resolvedTarget);

			// Target equals the blocked path, or is inside it
			if (resolvedTarget === resolvedBlocked || (!rel.startsWith("..") && rel !== "")) {
				return { blocked: true, matched: blocked };
			}

			// Also match by basename for single-segment patterns like ".env"
			if (!blocked.includes("/") && resolvedTarget.split("/").pop() === blocked) {
				return { blocked: true, matched: blocked };
			}
			continue;
		}

		// For absolute/home/variable paths
		const resolvedBlocked = resolve(expandPath(blocked));
		const rel = relative(resolvedBlocked, resolvedTarget);

		if ((!rel.startsWith("..") && rel !== "") || resolvedTarget === resolvedBlocked) {
			return { blocked: true, matched: blocked };
		}
	}
	return { blocked: false };
}

function isWriteAllowed(targetPath: string, allowWrite: string[], cwd: string): boolean {
	const resolvedTarget = resolve(expandPath(targetPath));

	for (const allowed of allowWrite) {
		const resolvedAllowed = resolve(cwd, expandPath(allowed));
		const rel = relative(resolvedAllowed, resolvedTarget);

		if ((!rel.startsWith("..") && rel !== "") || resolvedTarget === resolvedAllowed) {
			return true;
		}
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-sandbox", {
		description: "Disable sandboxing",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;

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

		const config = loadConfig(ctx.cwd);
		if (!config?.filesystem) return;

		const denyRead = config.filesystem.denyRead || [];
		const allowWrite = config.filesystem.allowWrite || ["."];
		const denyWrite = config.filesystem.denyWrite || [];

		// Handle read
		if (isToolCallEventType("read", event)) {
			const check = isPathBlocked(event.input.path, denyRead, ctx.cwd);
			if (check.blocked) {
				return {
					block: true,
					reason: `sandbox: read blocked - ${event.input.path} matches "${check.matched}"`,
				};
			}
			return;
		}

		// Handle write/edit
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const path = event.input.path;

			// Check denyWrite patterns first
			const denyCheck = isPathBlocked(path, denyWrite, ctx.cwd);
			if (denyCheck.blocked) {
				return {
					block: true,
					reason: `sandbox: write blocked - ${path} matches "${denyCheck.matched}"`,
				};
			}

			// Check if write is in allowed paths
			if (!isWriteAllowed(path, allowWrite, ctx.cwd)) {
				return {
					block: true,
					reason: `sandbox: write blocked - ${path} outside allowed paths: ${allowWrite.join(", ")}`,
				};
			}
			return;
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const noSandbox = pi.getFlag("no-sandbox") as boolean;

		if (noSandbox) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
			return;
		}

		const config = loadConfig(ctx.cwd);

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

			// Validate required filesystem section
			if (!config.filesystem) {
				ctx.ui.notify("Sandbox config missing 'filesystem' section", "error");
				sandboxEnabled = false;
				return;
			}

			await SandboxManager.initialize({
				network: config.network || { allowedDomains: [], deniedDomains: [] },
				filesystem: config.filesystem,
				ignoreViolations: configExt.ignoreViolations,
				enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
			});

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
			ctx.ui.notify(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		if (sandboxInitialized) {
			try {
				await SandboxManager.reset();
			} catch {
				// Ignore cleanup errors
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

			const config = loadConfig(ctx.cwd);
			if (!config) {
				ctx.ui.notify("No config loaded", "error");
				return;
			}

			const lines = [
				"Sandbox Configuration:",
				"",
				"Network:",
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
