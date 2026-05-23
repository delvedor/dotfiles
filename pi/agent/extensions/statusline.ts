/**
 * Status Line Extension for pi.dev
 *
 * Features:
 * - Fully theme-aware: reads ANSI codes from the active pi theme at render time
 * - Tide-style abbreviated paths
 * - Nerd Font icons
 * - Model, context %, cost, path, git branch
 *
 * Implementation notes:
 *   - Colors come from `theme.getFgAnsi(semanticRole)` — no hardcoded palette.
 *     Switching themes (e.g. dracula ↔ alucard) is reflected on the next render
 *     without any reload or event wiring.
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

interface RtkStatus {
	enabled: boolean;
	available: boolean;
}

function isRtkStatus(value: unknown): value is RtkStatus {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return typeof v.enabled === "boolean" && typeof v.available === "boolean";
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
	let rtkStatus: RtkStatus = { enabled: false, available: false };
	// Stored by apply() so the plan-mode listener can trigger an immediate
	// footer re-render when plan mode is toggled.
	let requestFooterRender: (() => void) | null = null;

	pi.events.on("plan-mode:status", (data) => {
		if (!isPlanModeStatus(data)) return;
		planMode = data;
		requestFooterRender?.();
	});
	pi.events.on("rtk:status", (data) => {
		if (!isRtkStatus(data)) return;
		rtkStatus = data;
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
		const t = ctx.ui.theme;
		const parts: string[] = [];
		const model = ctx.model?.id?.split("/").pop() ?? ctx.model?.id ?? "?";

		// Plan mode indicator — shown only when active
		if (planMode.executing) {
			parts.push(`${t.getFgAnsi("accent")}📋 ${planMode.completed}/${planMode.total}${RESET}`);
		} else if (planMode.enabled) {
			parts.push(`${t.getFgAnsi("warning")}⏸ plan${RESET}`);
		}

		// Session name (if set)
		if (sessionName) {
			parts.push(`${t.getFgAnsi("muted")}${ICONS.session} ${t.getFgAnsi("syntaxKeyword")}${sessionName}${RESET}`);
		}

		// Model
		parts.push(`${t.getFgAnsi("muted")}${ICONS.cpu} ${t.getFgAnsi("borderAccent")}${model}${RESET}`);

		// Context usage
		const usage = ctx.getContextUsage();
		if (usage && ctx.model?.contextWindow) {
			const pct = Math.round((usage.tokens / ctx.model.contextWindow) * 100);
			const ctxSize = fmtCtx(ctx.model.contextWindow);
			parts.push(
				`${t.getFgAnsi("muted")}${ICONS.database} ${t.getFgAnsi("thinkingMedium")}ctx:${t.getFgAnsi("text")}${pct}%${t.getFgAnsi("muted")}(${ctxSize})${RESET}`,
			);
		}

		// Token counts + cost (from cached totals)
		if (totals.input > 0 || totals.output > 0) {
			let tokenStr =
				`${t.getFgAnsi("muted")}${ICONS.usage} ` +
				`${t.getFgAnsi("bashMode")}${fmtCtx(totals.input)}${t.getFgAnsi("muted")}in ` +
				`${t.getFgAnsi("bashMode")}${fmtCtx(totals.output)}${t.getFgAnsi("muted")}out`;
			if (totals.cacheRead > 0)
				tokenStr += ` ${t.getFgAnsi("thinkingMedium")}${fmtCtx(totals.cacheRead)}${t.getFgAnsi("muted")}cr`;
			if (totals.cacheWrite > 0)
				tokenStr += ` ${t.getFgAnsi("thinkingMedium")}${fmtCtx(totals.cacheWrite)}${t.getFgAnsi("muted")}cw`;
			if (totals.cost > 0)
				tokenStr += ` ${t.getFgAnsi("success")}$${totals.cost.toFixed(4)}`;
			parts.push(tokenStr + RESET);
		}

		// RTK status
		parts.push(rtkStatus.enabled
			? `${t.getFgAnsi("success")}RTK✓${RESET}`
			: `${t.getFgAnsi("warning")}RTK✗${RESET}`);

		// Path
		const { parent, current } = tidePath(ctx.cwd, homedir());
		const pathStr = parent
			? `${t.getFgAnsi("muted")}${parent}${t.getFgAnsi("syntaxType")}${current}${RESET}`
			: `${t.getFgAnsi("syntaxType")}${current}${RESET}`;
		parts.push(`${t.getFgAnsi("muted")}${ICONS.folder} ${pathStr}`);

		// Git branch
		if (branchCache) {
			parts.push(`${t.getFgAnsi("muted")}${ICONS.branch} ${t.getFgAnsi("success")}${branchCache}${RESET}`);
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
			requestFooterRender = () => tui.requestRender();

			const unsubBranch = footerData.onBranchChange(() => {
				branchCache = "";
				updateBranch(ctx.cwd);
				tui.requestRender();
			});

			return {
				dispose: () => {
					requestFooterRender = null;
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
