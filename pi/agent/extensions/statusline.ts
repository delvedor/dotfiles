/**
 * Dracula Status Line Extension for pi.dev
 *
 * Features:
 * - Dracula theme colors (truecolor RGB)
 * - Tide-style abbreviated paths
 * - Nerd Font icons
 * - Model, context %, cost, path, git branch
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";

// === Dracula Theme Colors ===
const C = {
	purple: "\x1b[38;2;189;147;249m",
	pink: "\x1b[38;2;255;121;198m",
	cyan: "\x1b[38;2;139;233;253m",
	green: "\x1b[38;2;80;250;123m",
	yellow: "\x1b[38;2;241;250;140m",
	orange: "\x1b[38;2;255;184;108m",
	fg: "\x1b[38;2;248;248;242m",
	dim: "\x1b[38;2;98;114;164m",
	reset: "\x1b[0m",
};

// Nerd Font glyphs (MesloLGS Nerd Font Mono)
const ICONS = {
	cpu: "\u{F4BC}",       // nf-mdi-cpu
	database: "\u{F1C0}",  // nf-mdi-database 
	folder: "\u{F07B}",    // nf-fa-folder_open
	dollar: "\u{F155}",    // nf-fa-dollar
	branch: "\u{E0A0}",    // nf-pl-branch
	session: "\u{F086}",   // nf-fa-comments (session/chat icon)
};

// Config
interface Config {
	enabled: boolean;
}

const DEFAULT: Config = { enabled: true };
const STORAGE_KEY = "dracula-statusline-v1";

// === Utils ===

function tidePath(cwd: string, home: string): { parent: string; current: string } {
	const dp = cwd.startsWith(home) ? cwd.replace(home, "~") : cwd;
	if (dp === "~" || dp === "/") return { parent: "", current: dp };
	const parts = dp.split("/").filter(Boolean);
	if (parts.length === 0) return { parent: "", current: "/" };
	if (parts.length === 1) return { parent: "", current: parts[0]! };
	const current = parts[parts.length - 1]!;
	const initials = parts.slice(0, -1).map((p) => p[0]).join("/");
	const parent = dp.startsWith("/") ? `/${initials}/` : `${initials}/`;
	return { parent, current };
}

function fmtCtx(n: number): string {
	if (n >= 1000000) return `${(n / 1000000).toFixed(0)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
	return `${n}`;
}

function getGitBranch(cwd: string): string | null {
	try {
		execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
		const branch = execSync(
			"git -c core.useBuiltinFSMonitor=false symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD",
			{ cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
		).trim();
		return branch || null;
	} catch {
		return null;
	}
}

// === Main ===

export default function (pi: ExtensionAPI) {
	let config: Config = { ...DEFAULT };
	let branchCache = "";
	let lastCwd = "";
	
	function loadConfig(ctx: ExtensionContext) {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === STORAGE_KEY) {
				config = { ...DEFAULT, ...entry.data };
				return;
			}
		}
	}

	function saveConfig() {
		pi.appendEntry(STORAGE_KEY, { ...config });
	}

	function updateBranch(cwd: string) {
		if (cwd !== lastCwd) {
			lastCwd = cwd;
			branchCache = getGitBranch(cwd) || "";
		}
	}

	function buildLine(ctx: ExtensionContext, sessionName?: string): string {
		const parts: string[] = [];
		const model = ctx.model?.id?.split("/").pop() || ctx.model?.id || "?";

		// Session name (if set)
		if (sessionName) {
			parts.push(`${C.dim}${ICONS.session} ${C.pink}${sessionName}${C.reset}`);
		}

		// Model
		parts.push(`${C.dim}${ICONS.cpu} ${C.purple}${model}${C.reset}`);

		// Context usage
		const usage = ctx.getContextUsage();
		if (usage && ctx.model?.contextWindow) {
			const pct = Math.round((usage.tokens / ctx.model.contextWindow) * 100);
			const ctxSize = fmtCtx(ctx.model.contextWindow);
			parts.push(`${C.dim}${ICONS.database} ${C.yellow}ctx:${C.fg}${pct}%${C.dim}(${ctxSize})${C.reset}`);
		}

		// Cost
		let cost = 0;
		let input = 0, output = 0;
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type === "message" && e.message.role === "assistant") {
				const m = e.message as AssistantMessage;
				input += m.usage.input;
				output += m.usage.output;
				cost += m.usage.cost.total;
			}
		}
		parts.push(`${C.dim}${ICONS.dollar} ${C.orange}$${cost.toFixed(4)}${C.reset}`);

		// Path
		const { parent, current } = tidePath(ctx.cwd, process.env.HOME || "");
		const pathStr = parent
			? `${C.dim}${parent}${C.cyan}${current}${C.reset}`
			: `${C.cyan}${current}${C.reset}`;
		parts.push(`${C.dim}${ICONS.folder} ${pathStr}`);

		// Git branch
		if (branchCache) {
			parts.push(`${C.dim}${ICONS.branch} ${C.green}${branchCache}${C.reset}`);
		}

		return parts.join("  ");
	}

	function apply(ctx: ExtensionContext) {
		if (!config.enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}

		updateBranch(ctx.cwd);

		ctx.ui.setFooter((tui, _theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => {
				branchCache = "";
				updateBranch(ctx.cwd);
				tui.requestRender();
			});

			return {
				dispose: () => {
					unsubBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					updateBranch(ctx.cwd);
					const sessionName = pi.getSessionName() || undefined;
					const line = buildLine(ctx, sessionName);
					return [truncateToWidth(line, width)];
				},
			};
		});
	}

	// Events
	pi.on("session_start", (_event, ctx) => {
		loadConfig(ctx);
		if (config.enabled) apply(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		if (config.enabled) apply(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		if (config.enabled) apply(ctx);
	});

	// Commands
	pi.registerCommand("statusline", {
		description: "/statusline [toggle|enable|disable]",
		handler: async (args, ctx) => {
			const cmd = args.trim() || "toggle";
			
			switch (cmd) {
				case "toggle":
					config.enabled = !config.enabled;
					break;
				case "enable":
					config.enabled = true;
					break;
				case "disable":
					config.enabled = false;
					break;
				default:
					ctx.ui.notify("Usage: /statusline [toggle|enable|disable]", "error");
					return;
			}

			apply(ctx);
			saveConfig();
			ctx.ui.notify(`Status line ${config.enabled ? "on" : "off"}`, "info");
		},
	});
}
