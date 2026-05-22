/**
 * Dirty Repo Guard Extension
 *
 * Prevents session changes when there are uncommitted git changes.
 * Useful to ensure work is committed before switching context.
 *
 * Behaviour:
 *   - Not a git repo / git not installed → allow (silent).
 *   - Clean repo                          → allow.
 *   - Dirty + interactive UI              → ask the user.
 *   - Dirty + non-interactive             → block by default.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface GuardResult {
	cancel: boolean;
}

async function checkDirtyRepo(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: string,
): Promise<GuardResult | undefined> {
	// Use the default (line-based) porcelain output. Git c-quotes pathnames
	// with unusual characters by default, so line-counting is safe and
	// renames produce one line each (unlike `-z`, where a rename emits two
	// NUL records and would inflate the count).
	let stdout: string;
	let code: number;
	try {
		const result = await pi.exec("git", ["status", "--porcelain"]);
		stdout = result.stdout;
		code = result.code;
	} catch {
		// `git` not on PATH (or pi.exec failed). Treat as "not a repo".
		return undefined;
	}

	if (code !== 0) {
		// Non-zero exit — most commonly "not a git repository".
		return undefined;
	}

	const lines = stdout.split("\n").filter((s) => s.length > 0);
	if (lines.length === 0) return undefined;

	if (!ctx.hasUI) {
		// Non-interactive: block by default so dirty work isn't lost.
		return { cancel: true };
	}

	const choice = await ctx.ui.select(
		`You have ${lines.length} uncommitted file(s). ${action} anyway?`,
		["Yes, proceed anyway", "No, let me commit first"],
	);

	if (choice !== "Yes, proceed anyway") {
		ctx.ui.notify("Commit your changes first", "warning");
		return { cancel: true };
	}

	return undefined;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_before_switch", async (event, ctx) => {
		const action = event.reason === "new" ? "new session" : "switch session";
		return checkDirtyRepo(pi, ctx, action);
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		return checkDirtyRepo(pi, ctx, "fork");
	});
}
