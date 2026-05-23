/**
 * RTK Extension — Token-efficient output compression via rtk (https://github.com/rtk-ai/rtk)
 *
 * Two integration layers:
 *  1. Bash tool_call + user_bash: rewrites commands via `rtk rewrite` before execution
 *  2. tool_result: re-runs built-in tool commands through RTK (read, grep, find, ls)
 *     to compress the LLM-facing content; TUI details are always preserved for rendering
 *
 * State is never persisted — RTK is always enabled on session start unless --no-rtk.
 * Broadcasts { enabled, available } on pi.events "rtk:status" for statusline integration.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations, isToolCallEventType } from "@earendil-works/pi-coding-agent";

export interface RtkStatus {
	enabled: boolean;
	available: boolean;
}

export default function (pi: ExtensionAPI): void {
	let rtkAvailable = false;
	let rtkEnabled = true; // in-memory only — never persisted

	// ── CLI flag ─────────────────────────────────────────────────────────────

	pi.registerFlag("no-rtk", {
		description: "Disable RTK token compression for this session",
		type: "boolean",
		default: false,
	});

	// ── Helpers ──────────────────────────────────────────────────────────────

	/** Ask rtk to rewrite a shell command. Returns the original if rtk fails or has no rewrite. */
	async function rtkRewrite(command: string, signal?: AbortSignal, ctx?: ExtensionContext): Promise<string> {
		try {
			const result = await pi.exec("rtk", ["rewrite", command], { timeout: 5000, signal });
			// Exit 3 = rewrite performed (stdout has new command); exit 1 = passthrough (stdout empty)
			if (result.stdout.trim()) {
				return result.stdout.trim();
			}
		} catch (err) {
			// rtk crashed or signal aborted — fall back to original command
			// ("not installed" is excluded upstream via rtkEnabled guard)
			if (!signal?.aborted) {
				ctx?.ui.notify(`RTK rewrite error: ${err instanceof Error ? err.message : String(err)}`, "warning");
			}
		}
		return command;
	}

	/** Run `rtk <args>` and return stdout, or null on any failure. */
	async function rtkRun(args: string[], signal?: AbortSignal, ctx?: ExtensionContext): Promise<string | null> {
		try {
			const result = await pi.exec("rtk", args, { timeout: 30000, signal });
			if (result.code === 0) {
				return result.stdout;
			}
		} catch (err) {
			// rtk crashed or signal aborted — return null so caller keeps original content
			// ("not installed" is excluded upstream via rtkEnabled guard)
			if (!signal?.aborted) {
				ctx?.ui.notify(`RTK error: ${err instanceof Error ? err.message : String(err)}`, "warning");
			}
		}
		return null;
	}

	function emitStatus(): void {
		const status: RtkStatus = { enabled: rtkEnabled, available: rtkAvailable };
		pi.events.emit("rtk:status", status);
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Probe for rtk binary — sets rtkAvailable regardless of the result
		try {
			const probe = await pi.exec("rtk", ["--version"], { timeout: 5000 });
			rtkAvailable = probe.code === 0;
		} catch {
			rtkAvailable = false;
		}

		if (!rtkAvailable) {
			ctx.ui.notify("rtk not found in PATH — RTK compression disabled", "warning");
		}

		// Always reset to enabled (unless --no-rtk or binary absent) — no persistence
		rtkEnabled = rtkAvailable && pi.getFlag("no-rtk") !== true;

		emitStatus();
	});

	// ── Commands ─────────────────────────────────────────────────────────────

	pi.registerCommand("rtk", {
		description: "Toggle RTK token compression on/off for this session",
		handler: async (_args, ctx) => {
			if (!rtkAvailable) {
				ctx.ui.notify("RTK is not available (rtk binary not found in PATH)", "error");
				return;
			}
			rtkEnabled = !rtkEnabled;
			emitStatus();
			ctx.ui.notify(`RTK ${rtkEnabled ? "enabled ✓" : "disabled ✗"}`, "info");
		},
	});

	// ── Bash tool_call interception ──────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!rtkEnabled) return;
		if (!isToolCallEventType("bash", event)) return;

		const rewritten = await rtkRewrite(event.input.command, ctx.signal, ctx);
		if (rewritten !== event.input.command) {
			event.input.command = rewritten;
		}
	});

	// ── user_bash interception (! commands) ──────────────────────────────────

	pi.on("user_bash", (_event, ctx) => {
		if (!rtkEnabled) return;
		const local = createLocalBashOperations();
		return {
			operations: {
				exec(command: string, cwd: string, options: Parameters<typeof local.exec>[2]) {
					return rtkRewrite(command, undefined, ctx).then((rewritten) => local.exec(rewritten, cwd, options));
				},
			},
		};
	});

	// ── tool_result content compression ───────────────────────────────────────

	const COMPRESSIBLE = new Set(["read", "grep", "find", "ls"]);

	pi.on("tool_result", async (event, ctx) => {
		if (!rtkEnabled) return;
		if (event.isError) return;
		if (!COMPRESSIBLE.has(event.toolName)) return;

		// Skip if any block is non-text (e.g., images returned by the read tool)
		if (!event.content.every((b) => b.type === "text")) return;

		// Skip empty results — nothing meaningful to compress
		const originalText = event.content.map((b) => (b.type === "text" ? b.text : "")).join("");
		if (!originalText.trim()) return;

		let args: string[];

		if (event.toolName === "read") {
			const input = event.input as { path: string; offset?: number; limit?: number };
			// Skip partial reads — RTK re-running from byte 0 would misrepresent the intent
			if (input.offset !== undefined || input.limit !== undefined) return;
			args = ["read", input.path];
		} else if (event.toolName === "grep") {
			const input = event.input as { pattern: string; path?: string; glob?: string; include?: string };
			const searchPath = input.path || ctx.cwd;
			args = ["grep", input.pattern, searchPath];
			// Handle both parameter names used by different grep tool versions
			const glob = input.glob || input.include;
			if (glob) args.push("--glob", glob);
		} else if (event.toolName === "find") {
			const input = event.input as { pattern: string; path?: string };
			args = ["find", input.pattern, input.path || ctx.cwd];
		} else if (event.toolName === "ls") {
			const input = event.input as { path?: string };
			args = ["ls", input.path || ctx.cwd];
		} else {
			return;
		}

		const compressed = await rtkRun(args, ctx.signal, ctx);
		if (!compressed || !compressed.trim()) return;

		// Return only content — details is omitted so TUI rendering is preserved unchanged
		return { content: [{ type: "text" as const, text: compressed }] };
	});
}
