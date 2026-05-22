/**
 * DCG Guard Extension - Destructive Command Guard Integration
 *
 * Uses https://github.com/Dicklesworthstone/destructive_command_guard
 * to block dangerous bash commands before execution.
 *
 * Requires: dcg installed in PATH (e.g., ~/.local/bin/dcg).
 *
 * Implementation notes:
 *   - dcg is invoked via async execFile (NOT spawnSync) so the event loop
 *     is not blocked for up to 5s on every bash tool call.
 *   - Output is validated with a runtime type guard, never `as`-cast.
 *   - On dcg failure we fail OPEN (allow the command) but surface a single
 *     ui.notify per session so failures don't go unnoticed.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DCG_DECISIONS = ["allow", "deny", "warn"] as const;
type DCGDecision = (typeof DCG_DECISIONS)[number];

const DCG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
type DCGSeverity = (typeof DCG_SEVERITIES)[number];

interface DCGResult {
	schema_version: number;
	dcg_version: string;
	robot_mode: boolean;
	command: string;
	decision: DCGDecision;
	rule_id?: string;
	pack_id?: string;
	pattern_name?: string;
	reason?: string;
	explanation?: string;
	severity?: DCGSeverity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isDCGResult(value: unknown): value is DCGResult {
	if (!isRecord(value)) return false;
	if (typeof value.command !== "string") return false;
	if (typeof value.decision !== "string") return false;
	if (!DCG_DECISIONS.includes(value.decision as DCGDecision)) return false;
	if (value.severity !== undefined && !DCG_SEVERITIES.includes(value.severity as DCGSeverity)) return false;
	return true;
}

function stdoutFromError(err: unknown): string | null {
	if (typeof err !== "object" || err === null) return null;
	const maybe = (err as { stdout?: unknown }).stdout;
	return typeof maybe === "string" && maybe.length > 0 ? maybe : null;
}

async function checkCommand(command: string): Promise<DCGResult | null> {
	let stdout: string;
	try {
		const result = await execFileAsync("dcg", ["test", command], {
			encoding: "utf-8",
			env: { ...process.env, DCG_ROBOT: "1" },
			timeout: 5000,
		});
		stdout = result.stdout;
	} catch (err) {
		// execFile rejects on non-zero exit; dcg may still emit valid JSON to stdout
		// (e.g. some configurations exit non-zero on deny). Recover it when possible.
		const recovered = stdoutFromError(err);
		if (recovered === null) return null;
		stdout = recovered;
	}
	try {
		const parsed: unknown = JSON.parse(stdout);
		return isDCGResult(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

const SEVERITY_COLOR: Record<DCGSeverity, "error" | "warning" | "muted"> = {
	critical: "error",
	high: "warning",
	medium: "muted",
	low: "muted",
};

export default function (pi: ExtensionAPI): void {
	let dcgAvailable = false;
	let dcgFailureLogged = false;

	function noteDcgFailure(ctx: ExtensionContext, command: string): void {
		if (dcgFailureLogged) return;
		dcgFailureLogged = true;
		ctx.ui.notify(
			`DCG check failed (failing open). Affected command: ${command.slice(0, 80)}…`,
			"warning",
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		const probe = await checkCommand("echo test");
		dcgAvailable = probe !== null;
		dcgFailureLogged = false;

		if (dcgAvailable) {
			ctx.ui.setStatus("dcg", ctx.ui.theme.fg("success", "🛡️ DCG active"));
		} else {
			ctx.ui.setStatus("dcg", ctx.ui.theme.fg("warning", "⚠️ DCG not found"));
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!dcgAvailable) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		const result = await checkCommand(command);

		if (!result) {
			noteDcgFailure(ctx, command);
			return; // fail open
		}

		if (result.decision === "deny") {
			const severity: DCGSeverity = result.severity ?? "high";
			const color = SEVERITY_COLOR[severity];

			ctx.ui.setStatus(
				"dcg",
				ctx.ui.theme.fg(color, `🛡️ DCG blocked: ${result.pattern_name ?? "destructive command"}`),
			);

			const lines = [`DCG blocked destructive command (${severity})`];
			if (result.reason) {
				lines.push("", `Reason: ${result.reason}`);
			}
			if (result.explanation) {
				const explanation =
					result.explanation.length > 500 ? `${result.explanation.slice(0, 500)}…` : result.explanation;
				lines.push("", explanation);
			}
			if (result.pack_id) {
				lines.push("", `Rule: ${result.rule_id ?? "?"} (${result.pack_id})`);
			}

			return { block: true, reason: lines.join("\n") };
		}

		if (result.decision === "warn") {
			ctx.ui.setStatus(
				"dcg",
				ctx.ui.theme.fg("warning", `⚠️ DCG warning: ${result.pattern_name ?? "suspicious command"}`),
			);
		}
	});

	pi.registerCommand("dcg", {
		description: "Check DCG status",
		handler: async (_args, ctx) => {
			if (!dcgAvailable) {
				ctx.ui.notify("DCG not available - is dcg in PATH?", "error");
				return;
			}

			try {
				const { stdout, stderr } = await execFileAsync("dcg", ["packs"], { encoding: "utf-8" });
				ctx.ui.notify(`DCG Status:\n${stdout || stderr || "OK"}`, "info");
			} catch (err) {
				ctx.ui.notify(`DCG error: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});
}
