/**
 * Dracula Status Line Extension for pi.dev
 *
 * Features:
 * - Dracula theme colors (truecolor RGB)
 * - Tide-style abbreviated paths
 * - Nerd Font icons
 * - Model, context %, cost, path, git branch
 *
 * Implementation notes:
 *   - Token/cost totals are cached and only recomputed on turn_end / model_select /
 *     session_start, instead of sweeping the entire branch on every footer render.
 *   - Git branch is resolved with a single combined invocation
 *     (symbolic-ref → fallback to short SHA) rather than two separate execSync calls.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

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
} as const;
// Universal ANSI reset — not theme-specific.
const RESET = "\x1b[0m";

// State broadcast by the plan-mode extension on pi.events.
interface PlanModeStatus {
	enabled: boolean;
	executing: boolean;
	completed: number;
	total: number;
}

function isPlanModeStatus(value: unknown): value is PlanModeStatus {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.enabled === "boolean" &&
		typeof v.executing === "boolean" &&
		typeof v.completed === "number" &&
		typeof v.total === "number"
	);
}

// Nerd Font glyphs (MesloLGS Nerd Font Mono)
const ICONS = {
	cpu: "\u{F4BC}", // nf-mdi-cpu
	database: "\u{F1C0}", // nf-mdi-database
	folder: "\u{F07B}", // nf-fa-folder_open
	// Group icon for the tokens+cost field. NOT a dollar sign — the cost itself
	// is rendered as `$<n.nnnn>` later in the same segment, so a `$` glyph here
	// would double up. A neutral usage/stats glyph fits both halves.
	usage: "\u{F080}", // nf-fa-bar_chart
	branch: "\u{E0A0}", // nf-pl-branch
	session: "\u{F086}", // nf-fa-comments (session/chat icon)
} as const;

interface Config {
	enabled: boolean;
}

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

const DEFAULT: Config = { enabled: true };
const STORAGE_KEY = "dracula-statusline-v1";
const EMPTY_TOTALS: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

// === Utils ===

function isConfig(value: unknown): value is Partial<Config> {
	return typeof value === "object" && value !== null && (!("enabled" in value) || typeof value.enabled === "boolean");
}

function isStatuslineEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom" && entry.customType === STORAGE_KEY;
}

function tidePath(cwd: string, home: string): { parent: string; current: string } {
	const dp = home && cwd.startsWith(home) ? cwd.replace(home, "~") : cwd;
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
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
	return `${n}`;
}

function getGitBranch(cwd: string): string | null {
	try {
		// One combined call: prefer the symbolic ref; if HEAD is detached or this
		// isn't a git repo at all, fall back to the short SHA (or fail silently).
		const out = execSync(
			"git -c core.useBuiltinFSMonitor=false symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null",
			{ cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
		).trim();
		return out || null;
	} catch {
		return null;
	}
}

function accumulate(branch: readonly SessionEntry[]): UsageTotals {
	const totals: UsageTotals = { ...EMPTY_TOTALS };
	for (const e of branch) {
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		const usage = (e.message as AssistantMessage).usage;
		// Defensive defaults — some providers/models omit `cost` (or individual
		// counters) on assistant messages. Without these, the footer would render
		// `$NaN` or crash on `cost.total` access.
		totals.input += usage.input ?? 0;
		totals.output += usage.output ?? 0;
		totals.cacheRead += usage.cacheRead ?? 0;
		totals.cacheWrite += usage.cacheWrite ?? 0;
		totals.cost += usage.cost?.total ?? 0;
	}
	return totals;
}

// === Main ===

export default function (pi: ExtensionAPI): void {
	let config: Config = { ...DEFAULT };
	let branchCache = "";
	let lastCwd = "";
	let totals: UsageTotals = { ...EMPTY_TOTALS };

	let planMode: PlanModeStatus = { enabled: false, executing: false, completed: 0, total: 0 };
	// Stored by apply() so the plan-mode listener can trigger an immediate
	// footer re-render when plan mode is toggled.
	let requestFooterRender: (() => void) | null = null;

	pi.events.on("plan-mode:status", (data) => {
		if (!isPlanModeStatus(data)) return;
		planMode = data;
		requestFooterRender?.();
	});
	function loadConfig(ctx: ExtensionContext): void {
		// Scan in reverse so the *most recent* persisted toggle wins.
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (!isStatuslineEntry(entry)) continue;
			if (isConfig(entry.data)) {
				config = { ...DEFAULT, ...entry.data };
				return;
			}
		}
	}

	function saveConfig(): void {
		pi.appendEntry(STORAGE_KEY, { ...config });
	}

	function refreshTotals(ctx: ExtensionContext): void {
		totals = accumulate(ctx.sessionManager.getBranch());
	}

	function updateBranch(cwd: string): void {
		if (cwd !== lastCwd) {
			lastCwd = cwd;
			branchCache = getGitBranch(cwd) ?? "";
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

		// Cost / tokens (from cached totals)
		if (totals.input > 0 || totals.output > 0) {
			let tokenStr = `${C.dim}${ICONS.usage} ${C.orange}${fmtCtx(totals.input)}${C.dim}in ${C.orange}${fmtCtx(totals.output)}${C.dim}out`;
			if (totals.cacheRead > 0) tokenStr += ` ${C.yellow}${fmtCtx(totals.cacheRead)}${C.dim}cr`;
			if (totals.cacheWrite > 0) tokenStr += ` ${C.yellow}${fmtCtx(totals.cacheWrite)}${C.dim}cw`;
			if (totals.cost > 0) tokenStr += ` ${C.green}$${totals.cost.toFixed(4)}`;
			parts.push(tokenStr + C.reset);
		}

		// Path
		const { parent, current } = tidePath(ctx.cwd, homedir());
		const pathStr = parent ? `${C.dim}${parent}${C.cyan}${current}${C.reset}` : `${C.cyan}${current}${C.reset}`;
		parts.push(`${C.dim}${ICONS.folder} ${pathStr}`);

		// Git branch
		if (branchCache) {
			parts.push(`${C.dim}${ICONS.branch} ${C.green}${branchCache}${C.reset}`);
		}

		return parts.join("  ");
	}

	function apply(ctx: ExtensionContext): void {
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
		refreshTotals(ctx);
		if (config.enabled) apply(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		refreshTotals(ctx);
		if (config.enabled) apply(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		refreshTotals(ctx);
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
